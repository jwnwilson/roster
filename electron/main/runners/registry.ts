import type { Agent, RunnerId } from '../../../shared/types'
import { PiRunner } from './pi/runner'
import type { Runner } from './types'

/**
 * Resolves an agent's `runner` field to an implementation.
 *
 * Roster is a UI over Pi: every agent runs on Pi, whatever its agent.toml
 * says. Agents written for the retired Claude and Codex runners are migrated
 * to `runner = "pi"` on load (see migrateAgentsToPi); until then they still
 * resolve here, so nothing an older config names can leave an agent unable
 * to take a turn.
 */
const PI = new PiRunner()

export function piRunner(): PiRunner {
  return PI
}

/** Loads the SDK up front, so the first turn does not pay for the import. */
export async function warmUpRunners(): Promise<void> {
  await PI.warmUp()
}

export function getRunner(_id: RunnerId): Runner | null {
  return PI
}

export function allRunners(): Runner[] {
  return [PI]
}

export function isBuiltinRunner(id: RunnerId): boolean {
  return id === 'pi'
}

/**
 * Custom CLI runners are retired: Pi's own providers and extensions replace
 * them. Kept as a no-op so callers need not change.
 */
export function registerCustomRunners(_agents: Agent[]): void {}
