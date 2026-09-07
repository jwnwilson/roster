import { parse, stringify } from 'smol-toml'
import type { CustomRunnerSpec } from '../../../shared/types'

/**
 * An agent, packaged so it can be handed to someone else.
 *
 * An agent.toml on its own does not travel. Its `cwd` is a path on the
 * sender's machine, its `default_project` is a local id, and the names in its
 * `skills` and `mcp_servers` mean nothing on an install that lacks them. So a
 * bundle carries the agent, the text of every skill it uses, and enough about
 * each MCP server to recreate it — and nothing that is only true of the
 * machine it came from.
 *
 * What it never carries is an MCP server's environment. Roster keeps those in
 * the clear in mcp.json, so an export that took them would turn "share my
 * agent" into publishing an API token, which is not what anyone sharing an
 * agent is agreeing to. The key names travel so the recipient knows what to
 * supply; the values do not.
 */

export const BUNDLE_VERSION = 1

/** Skill and server names are directory and config keys, so they are constrained. */
const PLAIN_NAME = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/

export class BundleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BundleError'
  }
}

export interface BundleSkill {
  name: string
  /** The whole SKILL.md, so the recipient does not need the skill already. */
  body: string
}

export interface BundleMcpServer {
  name: string
  command: string
  /** The names of the variables the server needs. Never their values. */
  envKeys: string[]
}

export interface BundleAgent {
  name: string
  runner: string
  model: string
  systemPrompt: string
  /** Enabled skills, by name. Each has an entry in the bundle's `skills`. */
  skills: string[]
  /**
   * Enabled MCP servers, by name. Built-ins appear here and nowhere else:
   * they run inside Roster, so the recipient already has them and there is no
   * command to carry.
   */
  mcpServers: string[]
  custom?: CustomRunnerSpec
}

export interface AgentBundle {
  version: number
  agent: BundleAgent
  skills: BundleSkill[]
  mcpServers: BundleMcpServer[]
}

export function serializeBundle(bundle: AgentBundle): string {
  const agent: Record<string, unknown> = {
    name: bundle.agent.name,
    runner: bundle.agent.runner,
    model: bundle.agent.model,
    system_prompt: bundle.agent.systemPrompt,
    skills: bundle.agent.skills,
    mcp_servers: bundle.agent.mcpServers,
  }
  if (bundle.agent.custom) {
    agent['custom'] = { command: bundle.agent.custom.command, args: bundle.agent.custom.args }
  }

  const table = {
    version: bundle.version,
    agent,
    skill: bundle.skills.map((skill) => ({ name: skill.name, body: skill.body })),
    mcp_server: bundle.mcpServers.map((server) => ({
      name: server.name,
      command: server.command,
      env_keys: server.envKeys,
    })),
  }

  return `# Roster agent bundle\n${stringify(table)}\n`
}

/**
 * Reads a bundle, validating every field.
 *
 * A bundle arrives from another person, over a channel Roster knows nothing
 * about, so it is untrusted in the way agent.toml and setup.json are — every
 * field checked at this boundary, and failures naming the field so the person
 * holding a bad file can see what is wrong with it.
 */
export function parseBundle(raw: string): AgentBundle {
  let table: unknown
  try {
    table = parse(raw)
  } catch (cause) {
    throw new BundleError(`this is not a readable bundle: ${describe(cause)}`)
  }

  const fields = asTable(table, 'the bundle')

  const version = fields['version']
  if (version !== BUNDLE_VERSION) {
    throw new BundleError(
      `this bundle says version ${String(version)}, and this Roster reads version ${BUNDLE_VERSION}`,
    )
  }

  const agent = parseAgent(asTable(fields['agent'], 'agent'))
  const skills = asList(fields['skill'], 'skill').map(parseSkill)
  const mcpServers = asList(fields['mcp_server'], 'mcp_server').map(parseServer)

  assertSkillsMatch(agent.skills, skills)

  return { version: BUNDLE_VERSION, agent, skills, mcpServers }
}

function parseAgent(table: Record<string, unknown>): BundleAgent {
  const agent: BundleAgent = {
    name: requireString(table, 'name', 'agent'),
    runner: requireString(table, 'runner', 'agent'),
    model: optionalString(table, 'model'),
    systemPrompt: optionalString(table, 'system_prompt'),
    skills: nameList(table['skills'], 'agent.skills'),
    mcpServers: nameList(table['mcp_servers'], 'agent.mcp_servers'),
  }

  const custom = table['custom']
  if (custom !== undefined) {
    const spec = asTable(custom, 'agent.custom')
    agent.custom = {
      command: requireString(spec, 'command', 'agent.custom'),
      args: stringList(spec['args'], 'agent.custom.args'),
    }
  }

  return agent
}

function parseSkill(entry: unknown, index: number): BundleSkill {
  const table = asTable(entry, `skill[${index}]`)
  return {
    name: plainName(requireString(table, 'name', `skill[${index}]`), `skill[${index}].name`),
    body: optionalString(table, 'body'),
  }
}

function parseServer(entry: unknown, index: number): BundleMcpServer {
  const table = asTable(entry, `mcp_server[${index}]`)
  return {
    name: plainName(
      requireString(table, 'name', `mcp_server[${index}]`),
      `mcp_server[${index}].name`,
    ),
    command: requireString(table, 'command', `mcp_server[${index}]`),
    // Names only. A hand-written bundle may well carry values; they are read
    // past rather than trusted, so nothing can smuggle one into mcp.json.
    envKeys: stringList(table['env_keys'], `mcp_server[${index}].env_keys`),
  }
}

/**
 * Every enabled skill has a body, and every body is enabled.
 *
 * The two lists are written by hand as easily as by Roster. A skill with no
 * body would import an agent advertising what it cannot do; a body nothing
 * enables would write a file into the library for no reason.
 */
function assertSkillsMatch(enabled: readonly string[], skills: readonly BundleSkill[]): void {
  const carried = new Set(skills.map((skill) => skill.name))

  for (const name of enabled) {
    if (!carried.has(name)) {
      throw new BundleError(`the agent enables the skill "${name}" but the bundle has no copy of it`)
    }
  }

  const wanted = new Set(enabled)
  for (const skill of skills) {
    if (!wanted.has(skill.name)) {
      throw new BundleError(`the bundle carries the skill "${skill.name}" but the agent does not use it`)
    }
  }
}

/* ------------------------------------------------------------- validation */

function asTable(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BundleError(`${where} is missing, or is not a section`)
  }
  return value as Record<string, unknown>
}

function asList(value: unknown, where: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new BundleError(`${where} is not a list`)
  return value
}

function requireString(table: Record<string, unknown>, key: string, where: string): string {
  const value = table[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BundleError(`${where} is missing "${key}"`)
  }
  return value
}

function optionalString(table: Record<string, unknown>, key: string): string {
  const value = table[key]
  return typeof value === 'string' ? value : ''
}

function stringList(value: unknown, where: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new BundleError(`${where} is not a list`)

  return value.map((entry) => {
    if (typeof entry !== 'string') throw new BundleError(`${where} holds something that is not text`)
    return entry
  })
}

function nameList(value: unknown, where: string): string[] {
  return stringList(value, where).map((name) => plainName(name, where))
}

/**
 * A name that is safe to use as a directory and as a config key.
 *
 * The reason is not tidiness: a skill's name becomes a folder under the skill
 * library, and a bundle naming one `../../.ssh` would write outside it.
 */
function plainName(name: string, where: string): string {
  if (!PLAIN_NAME.test(name)) {
    throw new BundleError(
      `${where} is "${name}", which is not a plain name — letters, digits, - and _ only`,
    )
  }
  return name
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
