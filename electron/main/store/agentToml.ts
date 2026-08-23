import { homedir } from 'node:os'
import { parse, stringify } from 'smol-toml'
import { BUILTIN_RUNNERS, type CustomRunnerSpec } from '../../../shared/types'

/**
 * An agent.toml is hand-editable, so it is untrusted input: every field is
 * validated at this boundary and failures name the agent and the field.
 */
export class AgentConfigError extends Error {
  constructor(
    readonly agentId: string,
    message: string,
  ) {
    super(`agent.toml for "${agentId}": ${message}`)
    this.name = 'AgentConfigError'
  }
}

/** The persisted shape. Runtime status is derived elsewhere, never stored. */
export interface AgentConfig {
  id: string
  name: string
  runner: string
  model: string
  cwd: string
  systemPrompt: string
  skills: string[]
  mcpServers: string[]
  custom?: CustomRunnerSpec
}

export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return `${homedir()}/${path.slice(2)}`
  return path
}

export function collapseHome(path: string): string {
  const home = homedir()
  if (path === home) return '~'
  if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`
  return path
}

function requireString(agentId: string, table: Record<string, unknown>, key: string): string {
  const value = table[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentConfigError(agentId, `missing required string field "${key}"`)
  }
  return value
}

function optionalStringList(
  agentId: string,
  table: Record<string, unknown>,
  key: string,
): string[] {
  const value = table[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new AgentConfigError(agentId, `"${key}" must be an array of strings`)
  }
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new AgentConfigError(agentId, `"${key}" contains a non-string entry`)
    }
  }
  return value as string[]
}

function parseCustom(agentId: string, table: Record<string, unknown>): CustomRunnerSpec {
  const custom = table['custom']
  if (custom === null || typeof custom !== 'object' || Array.isArray(custom)) {
    throw new AgentConfigError(
      agentId,
      'a non-builtin runner requires a [custom] block with a command',
    )
  }
  const block = custom as Record<string, unknown>
  return {
    command: requireString(agentId, block, 'command'),
    args: optionalStringList(agentId, block, 'args'),
  }
}

export function parseAgentToml(agentId: string, source: string): AgentConfig {
  let table: Record<string, unknown>
  try {
    table = parse(source) as Record<string, unknown>
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new AgentConfigError(agentId, `could not be parsed — ${detail}`)
  }

  const runner = requireString(agentId, table, 'runner')
  const isBuiltin = (BUILTIN_RUNNERS as readonly string[]).includes(runner)

  const config: AgentConfig = {
    id: agentId,
    name: requireString(agentId, table, 'name'),
    runner,
    model: requireString(agentId, table, 'model'),
    cwd: expandHome(requireString(agentId, table, 'cwd')),
    systemPrompt: typeof table['system_prompt'] === 'string' ? table['system_prompt'] : '',
    skills: optionalStringList(agentId, table, 'skills'),
    mcpServers: optionalStringList(agentId, table, 'mcp_servers'),
  }

  if (!isBuiltin) config.custom = parseCustom(agentId, table)
  return config
}

export function serializeAgentToml(config: AgentConfig): string {
  const table: Record<string, unknown> = {
    name: config.name,
    runner: config.runner,
    model: config.model,
    cwd: collapseHome(config.cwd),
    system_prompt: config.systemPrompt,
    skills: config.skills,
    mcp_servers: config.mcpServers,
  }
  if (config.custom) {
    table['custom'] = { command: config.custom.command, args: config.custom.args }
  }
  return `${stringify(table)}\n`
}
