import type { PlanStatus } from './types'

/**
 * Plan mode's edges, shared between the main process and the renderer.
 *
 * An agent leaves plan mode by calling one specific tool, and both sides need
 * to recognise it: the main process to capture the plan, the renderer to
 * label the approval and offer it for review.
 */

/** The tool an agent calls to present its plan and leave plan mode. */
export const EXIT_PLAN_MODE = 'ExitPlanMode'

/**
 * The states where the agent is acting on a plan rather than waiting on you,
 * and how each reads in a sentence.
 *
 * One table for one rule, because two sides enforce it: the store refuses to
 * rewrite such a plan without a reason, and `propose_plan` is what tells the
 * agent so. Kept apart they would drift into a refusal the agent is told one
 * thing about and the store applies differently.
 */
export const IN_FLIGHT: Partial<Record<PlanStatus, string>> = {
  building: 'being built',
  in_review: 'up for review',
}

/**
 * Whether a plan has passed the point where rewriting it is free.
 *
 * Replacing one of these throws work away — a branch already cut, a pull
 * request already open — so it costs the agent a reason.
 */
export function isInFlight(status: PlanStatus): boolean {
  return IN_FLIGHT[status] !== undefined
}

/**
 * The plan out of an ExitPlanMode call's arguments.
 *
 * The arguments arrive as JSON written by a CLI, so this is a boundary:
 * anything that is not an object carrying a non-empty `plan` string is not a
 * plan, and says so rather than throwing into the middle of a turn.
 */
export function planFromToolInput(input: string | undefined): string | null {
  if (input === undefined) return null

  try {
    const parsed: unknown = JSON.parse(input)
    if (parsed === null || typeof parsed !== 'object') return null

    const plan = (parsed as { plan?: unknown }).plan
    if (typeof plan !== 'string' || plan.trim() === '') return null

    return plan
  } catch {
    return null
  }
}
