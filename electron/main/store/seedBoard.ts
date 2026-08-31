import type { Agent } from '../../../shared/types'
import type { ProjectStore } from './projects'
import type { TaskStore } from './tasks'

/**
 * First-run hook for the task board. A fresh install starts with an empty
 * board — no demo projects or tasks — so the board only ever shows a user's
 * own work.
 *
 * Kept as a function (rather than deleted outright) so ipc/index.ts has a
 * single, stable place to call into if seeded starter content is ever
 * reintroduced.
 */
export function seedBoardIfEmpty(
  _projects: ProjectStore,
  _tasks: TaskStore,
  _agents: readonly Agent[],
): boolean {
  return false
}
