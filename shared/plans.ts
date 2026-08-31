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
