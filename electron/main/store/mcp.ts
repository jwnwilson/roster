import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { McpServer } from '../../../shared/types'
import type { Disposable } from './agents'
import { mcpConfigPath } from './paths'

interface McpFile {
  servers: McpServer[]
}

/**
 * File-backed store over `~/roster/mcp.json`. Holds which servers exist and
 * how to launch them — nothing about which agents use them. That lives in each
 * agent's `mcp_servers`, so the two cannot disagree.
 */
export class McpStore {
  private servers: McpServer[] = []
  private watcher: FSWatcher | null = null
  private listeners = new Set<(servers: McpServer[]) => void>()

  async load(): Promise<void> {
    try {
      const raw = await readFile(mcpConfigPath(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<McpFile>
      this.servers = Array.isArray(parsed.servers) ? parsed.servers.map(normalize) : []
    } catch {
      // A missing or corrupt file means no servers configured, not a crash.
      this.servers = []
    }
  }

  findAll(): McpServer[] {
    return this.servers
  }

  /** Adds a server from the registry. Installing an existing one is a no-op. */
  async install(name: string, command: string): Promise<McpServer[]> {
    if (this.servers.some((server) => server.name === name)) return this.servers

    this.servers = [...this.servers, { name, command, env: {} }]
    await this.persist()
    return this.servers
  }

  /**
   * Replaces a server's launch settings. Unknown names are rejected rather
   * than quietly created, so a rename cannot strand an agent's `mcp_servers`
   * pointing at nothing.
   */
  async save(name: string, command: string, env: Record<string, string>): Promise<McpServer[]> {
    if (!this.servers.some((server) => server.name === name)) {
      throw new Error(`unknown MCP server "${name}"`)
    }

    this.servers = this.servers.map((server) =>
      server.name === name ? { name, command, env: { ...env } } : server,
    )
    await this.persist()
    return this.servers
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(mcpConfigPath()), { recursive: true })
    const body = `${JSON.stringify({ servers: this.servers }, null, 2)}\n`
    await writeFile(mcpConfigPath(), body, 'utf8')
  }

  watch(onChange: (servers: McpServer[]) => void): Disposable {
    this.listeners.add(onChange)
    this.startWatching()
    return {
      dispose: () => {
        this.listeners.delete(onChange)
        if (this.listeners.size === 0) this.stopWatching()
      },
    }
  }

  private startWatching(): void {
    if (this.watcher) return
    let pending: NodeJS.Timeout | null = null

    try {
      this.watcher = watch(mcpConfigPath(), () => {
        if (pending) clearTimeout(pending)
        pending = setTimeout(() => {
          void this.load().then(() => {
            for (const listener of this.listeners) listener(this.servers)
          })
        }, 80)
      })
    } catch {
      // Watching a file that does not exist yet is not fatal.
    }
  }

  private stopWatching(): void {
    this.watcher?.close()
    this.watcher = null
  }

  dispose(): void {
    this.listeners.clear()
    this.stopWatching()
  }
}

/**
 * The agent's `mcp_servers` with one server added or removed.
 *
 * Adding is idempotent and appends, so the order someone wired things up in
 * survives a round trip through the UI.
 */
export function withServer(
  names: readonly string[],
  server: string,
  enabled: boolean,
): string[] {
  const without = names.filter((name) => name !== server)
  return enabled ? [...without, server] : without
}

/**
 * Drops anything unrecognised, which includes the `enabledFor` list older
 * files carry — enablement moved to agent.toml, and that list never took
 * effect on its own.
 */
function normalize(entry: Partial<McpServer>): McpServer {
  return {
    name: typeof entry.name === 'string' ? entry.name : 'unknown',
    command: typeof entry.command === 'string' ? entry.command : '',
    env: normalizeEnv(entry.env),
  }
}

/** Only string values survive; a number or object in the file is dropped. */
function normalizeEnv(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (pair): pair is [string, string] => typeof pair[1] === 'string',
    ),
  )
}
