import type { Agent } from '../../../shared/types'
import type { AgentPatch } from '../../../shared/ipc'
import { migrateModelName } from '../runners/pi/models'

/** The part of the agent store a migration needs. */
export interface MigratableAgents {
  findAll(): Agent[]
  update(id: string, patch: AgentPatch): Promise<Agent>
}

/**
 * Points every agent at Pi.
 *
 * Roster no longer drives the Claude or Codex CLIs itself; Pi reaches the same
 * providers. The model is rewritten to Pi's `provider/id` so the agent keeps
 * the model it had — `claude-sonnet-5` becomes `anthropic/claude-sonnet-5`.
 * An agent whose agent.toml does not parse is not in `findAll` and is left
 * alone. Returns the ids it changed.
 */
export async function migrateAgentsToPi(agents: MigratableAgents): Promise<string[]> {
  const changed: string[] = []

  for (const agent of agents.findAll()) {
    if (agent.runner === 'pi') continue
    await agents.update(agent.id, {
      runner: 'pi',
      model: migrateModelName(agent.runner, agent.model),
    })
    changed.push(agent.id)
  }

  return changed
}
