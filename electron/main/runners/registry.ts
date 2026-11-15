import type { Agent, RunnerId } from '../../../shared/types'
import { ClaudeRunner } from './claude'
import { CodexRunner } from './codex'
import { PiRunner } from './pi/runner'
import type { Runner } from './types'

/**
 * Resolves an agent's `runner` field to an implementation.
 *
 * Three harnesses are offered, and each agent keeps the one it was given:
 * Pi (the default), Claude Code and Codex. Adapters are created once and
 * reused, since each owns the approvals it is blocked on.
 */
const PI = new PiRunner()
const RUNNERS = new Map<RunnerId, Runner>([
  ['pi', PI],
  ['claude', new ClaudeRunner()],
  ['codex', new CodexRunner()],
])

export function piRunner(): PiRunner {
  return PI
}

/** Loads the SDK and resolves binary paths up front, so the first turn does not pay for them. */
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
  return RUNNERS.has(id)
}

/**
 * Custom CLI runners are not offered: Pi's own providers and extensions cover
 * that ground. Kept as a no-op so callers need not change.
 */
export function registerCustomRunners(_agents: Agent[]): void {}
