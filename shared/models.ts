/**
 * Context window sizes, in tokens.
 *
 * Neither CLI publishes a machine-readable catalogue, so this is data Roster
 * owns and has to keep current. It lives in shared/ because both sides need
 * it: the main process turns a token count into a fraction, and the renderer
 * decides whether there is a bar to draw at all.
 *
 * An unknown model is expected, not exceptional — Codex offers whatever slugs
 * are in the user's own models_cache.json, and a custom runner can name
 * anything. Those report null so the UI can say so rather than draw an empty
 * bar that reads as "plenty of room left".
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-5': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'gpt-5.6-terra': 400_000,
  'gpt-5.6-luna': 400_000,
  'gpt-5.5': 400_000,
  'gpt-5.4-mini': 400_000,
}

export function contextWindowFor(model: string): number | null {
  return CONTEXT_WINDOWS[model] ?? null
}

/**
 * How full the window is, 0..1, or null when the model's size is unknown.
 * Capped at 1: a turn can report more than the window when the CLI counts
 * tokens Roster's table does not.
 */
export function contextFraction(model: string, tokens: number): number | null {
  const window = contextWindowFor(model)
  if (window === null || window <= 0) return null

  return Math.min(1, Math.max(0, tokens) / window)
}

/**
 * The fraction as a label. A turn that used a few thousand tokens of a 1M
 * window rounds to 0%, which reads the same as a session that has not
 * started — so anything non-empty says "<1%" instead.
 */
export function contextLabel(fraction: number): string {
  if (fraction <= 0) return '0%'

  const percent = Math.round(fraction * 100)
  return percent === 0 ? '<1%' : `${percent}%`
}
