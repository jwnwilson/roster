import { rm } from 'node:fs/promises'
import type { Session } from '../../../shared/types'
import { planDir } from '../store/paths'
import type { PlanStore } from '../store/plans'
import type { SessionStore } from '../store/sessions'

/**
 * What deleting a session needs, and no more.
 *
 * Structural rather than the concrete classes so this can be driven in a
 * test with two spies and an in-memory database — no Electron, no runner.
 */
export interface SessionRemovalDeps {
  sessions: Pick<SessionStore, 'findById' | 'delete'>
  plans: Pick<PlanStore, 'listBySession'>
  /**
   * Stops the turn in flight and waits for it to finish writing. Called
   * before anything is destroyed, so a half-unwound turn cannot insert rows
   * against a session that has already gone.
   */
  stopTurn: (sessionId: string) => Promise<void>
  /** Kills the pty this session was holding, if it opened one. */
  closeTerminal: (sessionId: string) => void
  /** Injected so the failure path can be exercised. */
  removeDirectory?: (path: string) => Promise<void>
}

/**
 * Deletes a session and everything that only existed because of it.
 *
 * The rows go through the schema's own foreign keys — messages, approvals,
 * usage, plans and their threads all cascade from `sessions`, and a task's
 * link to a session is a column on the session row, so it goes with it and
 * the task itself survives. What SQLite cannot reach is the plan Markdown at
 * `~/roster/plans/<id>`, which is deleted here rather than left behind as a
 * folder nothing can ever open again.
 *
 * A running session is stopped rather than refused: being unable to delete
 * something until you have found the Stop button is a worse answer than
 * stopping it for you, and the wait is bounded by the runner honouring its
 * abort signal — the same contract Cancel already depends on.
 *
 * Returns the session that was removed, or null when there was none.
 */
export async function removeSession(
  deps: SessionRemovalDeps,
  sessionId: string,
): Promise<Session | null> {
  const session = deps.sessions.findById(sessionId)
  if (!session) return null

  await deps.stopTurn(sessionId)
  deps.closeTerminal(sessionId)

  // Read before the delete: afterwards the rows are gone and there is
  // nothing left to say which folders belonged to this session.
  const planIds = deps.plans.listBySession(sessionId).map((plan) => plan.id)

  deps.sessions.delete(sessionId)

  // Last, and deliberately after the row: a folder that refuses to go is a
  // few kilobytes nobody can reach, whereas a row kept because of one is a
  // session the user asked to be rid of and still has.
  await removePlanFiles(deps, planIds)

  return session
}

async function removePlanFiles(deps: SessionRemovalDeps, planIds: string[]): Promise<void> {
  const remove =
    deps.removeDirectory ?? ((path: string) => rm(path, { recursive: true, force: true }))

  await Promise.all(
    planIds.map(async (planId) => {
      try {
        await remove(planDir(planId))
      } catch (cause) {
        // Reported, not thrown: the session is already gone, and failing here
        // would tell the user the delete did not happen when it did.
        const reason = cause instanceof Error ? cause.message : String(cause)
        process.stderr.write(`[sessions] could not delete plan files for "${planId}": ${reason}\n`)
      }
    }),
  )
}
