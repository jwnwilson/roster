import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import type { Agent, RunnerStatus } from '../../../shared/types'
import type { AgentPatch } from '../../../shared/ipc'
import { assertNameIsFree, normalizeAgentName } from '../../../shared/agentName'
import {
  AgentConfigError,
  collapseHome,
  parseAgentToml,
  serializeAgentToml,
  type AgentConfig,
} from './agentToml'
import { agentsDir, agentDir, agentTomlPath } from './paths'

export interface Disposable {
  dispose(): void
}

export interface NewAgentInput {
  name: string
  runner: string
  model: string
  cwd: string
  systemPrompt: string
  skills: string[]
  mcpServers?: string[]
}

/** Agent ids double as directory names, so they must be filesystem-safe. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'agent' : slug
}

/**
 * File-backed store over `~/roster/agents/<id>/agent.toml`.
 *
 * Unlike the SQLite stores, this data can change underneath Roster — a user
 * edits the file, or checks out a branch — so it exposes a change
 * subscription. Nothing else in the app reads or writes agent.toml.
 */
export class AgentStore {
  /** Last known good config per agent, so one broken file cannot hide the rest. */
  private configs = new Map<string, AgentConfig>()
  /** Parse failures, surfaced as `error` status rather than swallowed. */
  private failures = new Map<string, string>()
  private watcher: FSWatcher | null = null
  private listeners = new Set<(agents: Agent[]) => void>()

  constructor(private readonly runnerStatus: () => Map<string, RunnerStatus>) {}

  async load(): Promise<void> {
    await mkdir(agentsDir(), { recursive: true })
    const entries = await readdir(agentsDir(), { withFileTypes: true })

    this.configs.clear()
    this.failures.clear()

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      await this.loadOne(entry.name)
    }
  }

  private async loadOne(agentId: string): Promise<void> {
    try {
      const source = await readFile(agentTomlPath(agentId), 'utf8')
      this.configs.set(agentId, parseAgentToml(agentId, source))
      this.failures.delete(agentId)
    } catch (cause) {
      if (isMissingFile(cause)) return // a directory without an agent.toml is not an agent
      const message = cause instanceof AgentConfigError ? cause.message : String(cause)
      this.failures.set(agentId, message)
      this.configs.delete(agentId)
    }
  }

  findAll(): Agent[] {
    const agents = [...this.configs.values()].map((config) => this.toAgent(config))
    const broken = [...this.failures.entries()].map(([id, detail]) => brokenAgent(id, detail))
    return [...agents, ...broken].sort((a, b) => a.name.localeCompare(b.name))
  }

  findById(id: string): Agent | null {
    const config = this.configs.get(id)
    if (config) return this.toAgent(config)
    const failure = this.failures.get(id)
    return failure ? brokenAgent(id, failure) : null
  }

  /**
   * Writes a new agent.toml. The id is derived from the name and made unique,
   * since it is also the directory name.
   */
  async create(input: NewAgentInput): Promise<Agent> {
    const name = normalizeAgentName(input.name)
    assertNameIsFree(name, this.configs.values())
    const id = this.uniqueId(slugify(name))

    const config: AgentConfig = {
      id,
      name,
      runner: input.runner,
      model: input.model,
      cwd: input.cwd,
      systemPrompt: input.systemPrompt,
      skills: input.skills,
      mcpServers: input.mcpServers ?? [],
      hidden: false,
    }

    await mkdir(agentDir(id), { recursive: true })
    // The working directory must exist before the agent runs: spawning into
    // a missing cwd fails with ENOENT that reads as a missing binary.
    await mkdir(config.cwd, { recursive: true })
    await writeFile(agentTomlPath(id), serializeAgentToml(config), 'utf8')
    this.configs.set(id, config)

    return this.toAgent(config)
  }

  private uniqueId(base: string): string {
    if (!this.configs.has(base) && !this.failures.has(base)) return base

    for (let n = 2; n < 1_000; n += 1) {
      const candidate = `${base}-${n}`
      if (!this.configs.has(candidate) && !this.failures.has(candidate)) return candidate
    }
    throw new Error(`could not find a free id for "${base}"`)
  }

  async update(id: string, patch: AgentPatch): Promise<Agent> {
    const current = this.configs.get(id)
    if (!current) {
      // Naming the parse error beats "unknown agent", which sends you looking
      // for a directory that is in fact right there.
      const failure = this.failures.get(id)
      if (failure) throw new Error(`cannot change an agent that does not parse — ${failure}`)
      throw new Error(`unknown agent "${id}"`)
    }

    // The name is a label, not an identity: the id and the directory stay put
    // so sessions, tasks, plans and mentions keep pointing at the same agent.
    const name = patch.name === undefined ? current.name : normalizeAgentName(patch.name)
    if (patch.name !== undefined) assertNameIsFree(name, this.configs.values(), id)

    const next: AgentConfig = {
      ...current,
      name,
      ...(patch.runner !== undefined ? { runner: patch.runner } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
      ...(patch.skills !== undefined ? { skills: patch.skills } : {}),
      ...(patch.mcpServers !== undefined ? { mcpServers: patch.mcpServers } : {}),
      ...(patch.cwd !== undefined ? { cwd: patch.cwd } : {}),
      ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
    }

    // A new working directory must exist before the agent runs there.
    if (patch.cwd !== undefined) await mkdir(next.cwd, { recursive: true })

    await mkdir(agentDir(id), { recursive: true })
    await writeFile(agentTomlPath(id), serializeAgentToml(next), 'utf8')
    this.configs.set(id, next)

    return this.toAgent(next)
  }

  /** Emits whenever any agent.toml changes, including edits made outside Roster. */
  watch(onChange: (agents: Agent[]) => void): Disposable {
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

    this.watcher = watch(agentsDir(), { recursive: true }, () => {
      // Editors write in several syscalls; coalesce the burst into one reload.
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        void this.load().then(() => {
          const agents = this.findAll()
          for (const listener of this.listeners) listener(agents)
        })
      }, 80)
    })
  }

  private stopWatching(): void {
    this.watcher?.close()
    this.watcher = null
  }

  dispose(): void {
    this.listeners.clear()
    this.stopWatching()
  }

  private toAgent(config: AgentConfig): Agent {
    const runner = this.runnerStatus().get(config.runner)

    // An agent whose runner is missing or logged out cannot run, so it takes
    // the `error` status the design handoff defines but never reaches.
    const unusable = !runner || !runner.ready

    return {
      id: config.id,
      name: config.name,
      runner: config.runner,
      model: config.model,
      cwd: config.cwd,
      cwdLabel: collapseHome(config.cwd),
      systemPrompt: config.systemPrompt,
      skills: config.skills,
      mcpServers: config.mcpServers,
      hidden: config.hidden,
      ...(config.custom ? { custom: config.custom } : {}),
      status: unusable ? 'error' : 'idle',
      ...(unusable
        ? { statusDetail: runner?.detail ?? `runner "${config.runner}" is not available` }
        : {}),
    }
  }
}

function brokenAgent(id: string, detail: string): Agent {
  return {
    id,
    name: id,
    runner: 'unknown',
    model: '—',
    cwd: '',
    cwdLabel: '',
    systemPrompt: '',
    skills: [],
    mcpServers: [],
    // Never hidden: the error is the entire reason to show this row.
    hidden: false,
    status: 'error',
    statusDetail: detail,
  }
}

function isMissingFile(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT'
}
