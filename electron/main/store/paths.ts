import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Roster's home. The design handoff establishes `~/roster/skills` as the skill
 * library, so the rest of Roster's state lives alongside it.
 *
 * Agent configs live at `~/roster/agents/<id>/agent.toml` rather than in each
 * agent's working directory: the handoff's own data has four agents sharing
 * `~/work/api`, which a single per-directory file cannot represent. Each
 * config names its own `cwd`.
 */
export function rosterHome(): string {
  return process.env['ROSTER_HOME'] ?? join(homedir(), 'roster')
}

export function agentsDir(): string {
  return join(rosterHome(), 'agents')
}

export function agentDir(agentId: string): string {
  return join(agentsDir(), agentId)
}

export function agentTomlPath(agentId: string): string {
  return join(agentDir(agentId), 'agent.toml')
}

export function skillsDir(): string {
  return join(rosterHome(), 'skills')
}

export function mcpConfigPath(): string {
  return join(rosterHome(), 'mcp.json')
}

export function databasePath(): string {
  return join(rosterHome(), 'roster.db')
}
