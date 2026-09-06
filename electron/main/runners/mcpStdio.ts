import { connect, type Socket } from 'node:net'
import { pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { ROSTER_SERVER } from '../../../shared/mcp'

/**
 * The MCP server `codex exec` spawns, and the only part of Roster that runs
 * outside the main process.
 *
 * It is deliberately hollow. It holds no tools, opens no database and reads
 * no files: it connects back to the bridge in the main process, asks what the
 * tools are, and forwards every call there. Everything a tool actually does
 * — the stores, the History lines, the events the renderer listens to —
 * happens in the process that already owns them, exactly as it does for a
 * Claude agent.
 *
 * Nothing here decides anything, which is the point: a process holding a
 * user's project data should be as small as it can be made.
 */

/** The main process, as this child talks to it. */
export interface BridgeClient {
  tools(): Tool[]
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>
  /** Called once when Roster is no longer reachable. See `main`. */
  onLost(handler: () => void): void
  close(): void
}

/**
 * Opens the socket, presents the token, and reads the tool list.
 *
 * The tools are fetched once, on connect, because that is when Codex asks for
 * them and they do not change inside a turn.
 */
export function connectToBridge(address: string, token: string): Promise<BridgeClient> {
  return new Promise((resolve, reject) => {
    const socket = connect(address)
    socket.setEncoding('utf8')

    let nextId = 1
    const waiting = new Map<number, (reply: Record<string, unknown>) => void>()
    let buffer = ''

    /**
     * The connection is gone, for whatever reason.
     *
     * Everything still in flight is answered rather than left waiting: a
     * turn whose tool call never settles is a turn that hangs for good. The
     * `reject` is what reports a connection that never came up at all, and
     * does nothing once this promise has already resolved.
     */
    let lost: (() => void) | null = null
    const abandon = (message: string): void => {
      for (const [, settle] of waiting) settle({ error: message })
      waiting.clear()
      socket.destroy()
      reject(new Error(message))
      const notify = lost
      lost = null
      notify?.()
    }

    socket.on('error', (cause: Error) => abandon(cause.message))
    socket.on('close', () => abandon('Roster closed the connection'))

    socket.on('data', (chunk: string) => {
      buffer += chunk
      let end = buffer.indexOf('\n')
      while (end >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        // A line that will not parse means this is not the bridge on the
        // other end, or it is no longer well. Either way there is nothing to
        // resume from, and this process is the one part of Roster running
        // outside its own main process — so it gives up rather than
        // continuing on a stream it cannot read.
        let reply: Record<string, unknown>
        try {
          reply = JSON.parse(line) as Record<string, unknown>
        } catch {
          abandon('Roster sent something this server could not read')
          return
        }

        const settle = waiting.get(reply['id'] as number)
        waiting.delete(reply['id'] as number)
        settle?.(reply)
        end = buffer.indexOf('\n')
      }
    })

    const send = (
      op: string,
      payload: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const id = nextId++
      return new Promise((settle) => {
        waiting.set(id, settle)
        socket.write(`${JSON.stringify({ id, op, token, ...payload })}\n`)
      })
    }

    socket.on('connect', () => {
      void send('list', {}).then((reply) => {
        const listed = Array.isArray(reply['tools']) ? (reply['tools'] as Tool[]) : null
        if (!listed) {
          abandon('Roster did not send a tool list')
          return
        }

        resolve({
          tools: () => listed,
          call: async (name, args) => {
            const reply = await send('call', { name, args })
            return toCallToolResult(reply)
          },
          onLost: (handler) => {
            lost = handler
          },
          close: () => {
            // Deliberate, so it is not reported as Roster disappearing.
            lost = null
            socket.destroy()
          },
        })
      })
    })
  })
}

/**
 * A reply as MCP wants it.
 *
 * A bridge that answered with an `error` rather than a result is still a tool
 * result here: the agent is told what went wrong and carries on, which beats
 * a protocol error that ends its turn.
 */
function toCallToolResult(reply: Record<string, unknown>): CallToolResult {
  if (typeof reply['error'] === 'string') {
    return { content: [{ type: 'text', text: reply['error'] }], isError: true }
  }

  return {
    content: (reply['content'] ?? []) as CallToolResult['content'],
    ...(reply['isError'] === true ? { isError: true } : {}),
  }
}

/** The MCP server itself: a list, and a forwarder. */
export async function createProxyServer(bridge: BridgeClient): Promise<Server> {
  const server = new Server(
    { name: ROSTER_SERVER, version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: bridge.tools() }))
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    bridge.call(request.params.name, request.params.arguments ?? {}),
  )

  return server
}

async function main(): Promise<void> {
  const address = process.env['ROSTER_MCP_SOCKET']
  const token = process.env['ROSTER_MCP_TOKEN']
  if (address === undefined || token === undefined) {
    process.stderr.write('[roster-mcp] no socket to connect to; refusing to start\n')
    process.exit(1)
  }

  const bridge = await connectToBridge(address, token)
  const server = await createProxyServer(bridge)
  await server.connect(new StdioServerTransport())

  // This process must not outlive either end of what it sits between.
  //
  // Codex closing the pipe is the ordinary case. Roster closing the socket is
  // the one that matters: the bridge is taken down the moment a turn ends, so
  // a `codex exec` that leaked this child — or one still running after Roster
  // quit — stops here rather than staying up until the machine is rebooted.
  server.onclose = () => {
    bridge.close()
    process.exit(0)
  }
  bridge.onLost(() => process.exit(0))
}

/**
 * Run only when this file *is* the process, never when it is imported.
 *
 * The tests import it to drive the same server over an in-memory transport,
 * and a top-level `main()` would have them fighting over stdin.
 */
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main().catch((cause: unknown) => {
    process.stderr.write(`[roster-mcp] ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exit(1)
  })
}
