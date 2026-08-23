import type { Agent, RunnerId } from '../../../shared/types'
import { ClaudeRunner } from './claude'
import { CodexRunner } from './codex'
import { CustomRunner, type CustomDialect } from './custom'
import type { Runner } from './types'

/**
 * Resolves an agent's `runner` field to an implementation.
 *
 * Adapters are created once and reused, since each owns the approvals it is
 * blocked on. Custom runners are registered lazily from the agents that
 * declare them.
 */
const RUNNERS = new Map<RunnerId, Runner>([
  ['claude', new ClaudeRunner()],
  ['codex', new CodexRunner()],
])

/** Resolves binary paths up front, so the first run cannot fail on PATH. */
export async function warmUpRunners(): Promise<void> {
  await Promise.all(
    [...RUNNERS.values()].map(async (runner) => {
      const warm = runner as Runner & { warmUp?: () => Promise<void> }
      if (warm.warmUp) await warm.warmUp()
    }),
  )
}

export function getRunner(id: RunnerId): Runner | null {
  return RUNNERS.get(id) ?? null
}

export function allRunners(): Runner[] {
  return [...RUNNERS.values()]
}

export function isBuiltinRunner(id: RunnerId): boolean {
  return id === 'claude' || id === 'codex'
}

/**
 * Registers a runner for every agent that names a custom command, so
 * bringing your own CLI needs only an agent.toml entry.
 */
export function registerCustomRunners(agents: Agent[]): void {
  for (const agent of agents) {
    if (isBuiltinRunner(agent.runner) || !agent.custom) continue
    if (RUNNERS.has(agent.runner)) continue

    RUNNERS.set(
      agent.runner,
      new CustomRunner(agent.runner, agent.custom, dialectFor(agent.custom.command)),
    )
  }
}

/** A custom CLI declares its dialect by name; claude-shaped is the default. */
function dialectFor(command: string): CustomDialect {
  return /codex/i.test(command) ? 'codex' : 'claude'
}
