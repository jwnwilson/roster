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
 * which agents each is wired into; the runner layer turns this into per-agent
 * MCP config when starting a session.
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

    this.servers = [...this.servers, { name, command, enabledFor: [] }]
    await this.persist()
    return this.servers
  }

  async setEnabled(server: string, agentId: string, enabled: boolean): Promise<void> {
    this.servers = this.servers.map((entry) => {
      if (entry.name !== server) return entry
      const without = entry.enabledFor.filter((id) => id !== agentId)
      return { ...entry, enabledFor: enabled ? [...without, agentId] : without }
    })
    await this.persist()
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

function normalize(entry: Partial<McpServer>): McpServer {
  return {
    name: typeof entry.name === 'string' ? entry.name : 'unknown',
    command: typeof entry.command === 'string' ? entry.command : '',
    enabledFor: Array.isArray(entry.enabledFor)
      ? entry.enabledFor.filter((id): id is string => typeof id === 'string')
      : [],
  }
}
