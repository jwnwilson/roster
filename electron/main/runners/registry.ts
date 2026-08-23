import type { RunnerId } from '../../../shared/types'
import { ClaudeRunner } from './claude'
import type { Runner } from './types'

/**
 * Resolves an agent's `runner` field to an implementation. Adapters are
 * created once and reused, since each owns the approvals it is blocked on.
 */
const RUNNERS = new Map<RunnerId, Runner>([['claude', new ClaudeRunner()]])

export function getRunner(id: RunnerId): Runner | null {
  return RUNNERS.get(id) ?? null
}

export function allRunners(): Runner[] {
  return [...RUNNERS.values()]
}
