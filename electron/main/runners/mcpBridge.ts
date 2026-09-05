import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { toWireTools, type BuiltinToolDefinition, type WireTool } from './toolDefinitions'
import type { McpLaunchSpec } from './types'

/**
 * Roster's built-in tools, reachable from a CLI running in another process.
 *
 * Claude runs inside Roster, so it is handed the tool objects themselves. A
 * Codex agent is a separate `codex exec` process, and an in-process server
 * cannot be given to one — it needs a real MCP server it can spawn. That
 * server is `mcpStdio.ts`, and it is deliberately empty: it knows no tools,
 * no stores and no database. It asks this bridge what the tools are and
 * forwards every call back to it, so the handlers run here, in the process
 * that owns the SQLite connection and the stores.
 *
 * That is the whole reason for the socket. The alternative — letting the
 * child open `roster.db` itself — would put a second writer on a
 * `better-sqlite3` database whose only writer today is this process, and
 * would skip the stores entirely: a task moved by an agent would miss its
 * History line and the renderer would never hear about it. Neither is a
 * trade worth making to avoid a socket.
 *
 * The socket is the security boundary, so it is drawn tightly: a directory
 * only this user can enter, a per-turn token, and every argument checked
 * against the tool's own schema on this side before a handler sees it. The
 * child is a proxy with no authority of its own.
 */
export class McpBridge {
  private constructor(
    private readonly server: Server,
    /** The 0700 directory holding the socket; exposed so its mode is testable. */
    readonly dir: string,
    readonly address: string,
    readonly token: string,
    private readonly tools: Map<string, BuiltinToolDefinition>,
    private readonly wire: WireTool[],
    private readonly entry: string,
  ) {}

  /** Live connections, so closing the bridge really does end them. */
  private readonly open = new Set<Socket>()
  private closed = false

  static async start(
    definitions: BuiltinToolDefinition[],
    options: { entry?: string; platform?: NodeJS.Platform } = {},
  ): Promise<McpBridge> {
    // The directory is the access control: it is created 0700, so only this
    // user can reach the socket inside it whatever the socket's own mode
    // says. That comes from `mkdtemp` itself, which is specified to create
    // the directory readable, writable and searchable only by its owner —
    // there is no mode option here to pass and none is passed. `bridgeDirMode`
    // is the test that keeps that guarantee honest.
    //
    // It also has to be short. A unix socket path is capped at around 104
    // bytes on macOS, and listen() fails with EINVAL rather than anything
    // that names the real problem — hence the terse prefix and the one-letter
    // socket name.
    const dir = await mkdtemp(join(tmpdir(), 'roster-mcp-'))
    const platform = options.platform ?? process.platform
    const address = bridgeAddress(platform, dir)

    const tools = new Map(definitions.map((definition) => [definition.name, definition]))
    const bridge = new McpBridge(
      createServer(),
      dir,
      address,
      randomBytes(24).toString('hex'),
      tools,
      toWireTools(definitions),
      options.entry ?? stdioEntryPath(),
    )

    bridge.server.on('connection', (socket) => bridge.accept(socket))
    await new Promise<void>((resolve, reject) => {
      bridge.server.once('error', reject)
      bridge.server.listen(address, resolve)
    })

    return bridge
  }

  /**
   * How `codex exec` is told to start the server.
   *
   * Roster's own binary run as Node, rather than whatever `node` happens to
   * be on PATH: a packaged Roster cannot assume the user has Node installed,
   * and the child has to resolve `@modelcontextprotocol/sdk` out of the app's
   * own modules. Codex hands its MCP children a scrubbed environment — not
   * the parent's — so everything the child needs is named here.
   */
  launchSpec(): McpLaunchSpec {
    return {
      command: process.execPath,
      args: [this.entry],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        ROSTER_MCP_SOCKET: this.address,
        ROSTER_MCP_TOKEN: this.token,
      },
    }
  }

  private accept(socket: Socket): void {
    this.open.add(socket)
    socket.on('close', () => this.open.delete(socket))
    // A child that dies mid-write must not take the turn down with it.
    socket.on('error', () => socket.destroy())

    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      // A caller that never sends a newline would otherwise buffer without
      // limit; nothing Roster's own child sends comes near this.
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy()
        return
      }

      let end = buffer.indexOf('\n')
      while (end >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        void this.handleLine(socket, line)
        end = buffer.indexOf('\n')
      }
    })
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    const request = parseRequest(line)
    // An unparseable line or a wrong token is not answered, it ends the
    // connection: whoever sent it is not the child this bridge started.
    if (!request || !this.tokenMatches(request.token)) {
      socket.destroy()
      return
    }

    const reply = await this.answer(request)
    if (socket.destroyed) return
    socket.write(`${JSON.stringify(reply)}\n`)
  }

  private async answer(request: BridgeRequest): Promise<Record<string, unknown>> {
    if (request.op === 'list') return { id: request.id, tools: this.wire }
    if (request.op !== 'call') {
      return { id: request.id, error: `unknown operation "${request.op}"` }
    }

    const definition = request.name === undefined ? undefined : this.tools.get(request.name)
    if (!definition) {
      return { id: request.id, ...failed(`No tool called "${request.name ?? ''}".`) }
    }

    // The arguments crossed a process boundary, so they are checked here
    // rather than trusted: the child does no validation and is not asked to.
    const parsed = z.object(definition.inputSchema as z.ZodRawShape).safeParse(request.args)
    if (!parsed.success) {
      return {
        id: request.id,
        ...failed(`Those arguments do not fit ${definition.name}: ${parsed.error.message}`),
      }
    }

    try {
      const result = await definition.handler(parsed.data as never, undefined)
      return { id: request.id, ...result }
    } catch (cause) {
      // A handler that throws is a tool that failed, not a turn that should
      // end — the agent is told, and goes on.
      return { id: request.id, ...failed(describe(cause)) }
    }
  }

  private tokenMatches(candidate: unknown): boolean {
    if (typeof candidate !== 'string' || candidate.length !== this.token.length) return false
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(this.token))
  }

  /**
   * Stops listening and takes the socket away.
   *
   * Called when the turn ends, however it ended. Destroying the live
   * connections matters as much as closing the server: a child whose codex
   * parent leaked it sees its socket die and exits, so no turn can leave one
   * behind.
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    for (const socket of this.open) socket.destroy()
    this.open.clear()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
    await rm(this.dir, { recursive: true, force: true })
  }
}

/** Long enough for any real request, short enough to bound a bad one. */
const MAX_REQUEST_BYTES = 1_000_000

interface BridgeRequest {
  id: unknown
  op: string
  token: unknown
  name?: string
  args?: unknown
}

function parseRequest(line: string): BridgeRequest | null {
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null) return null

    const record = parsed as Record<string, unknown>
    if (typeof record['op'] !== 'string') return null

    return {
      id: record['id'],
      op: record['op'],
      token: record['token'],
      ...(typeof record['name'] === 'string' ? { name: record['name'] } : {}),
      args: record['args'],
    }
  } catch {
    return null
  }
}

function failed(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Where the bridge listens.
 *
 * Windows has no socket files, so the same connection is a named pipe there;
 * `net` dials both through the same `connect(path)`, so nothing above this
 * has to know which it got.
 */
export function bridgeAddress(platform: NodeJS.Platform, dir: string): string {
  if (platform === 'win32') {
    return `\\\\.\\pipe\\roster-mcp-${randomBytes(12).toString('hex')}`
  }
  // One character, because the whole path has to fit in about 104 bytes.
  return join(dir, 's')
}

/**
 * The stdio server's own file, beside the main bundle it is built next to.
 *
 * Resolved from this module rather than from the app root so it is right in a
 * dev run and inside a packaged app's asar alike.
 */
function stdioEntryPath(): string {
  return join(import.meta.dirname, 'mcpStdio.js')
}
