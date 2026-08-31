/**
 * Readouts shared by the grid cards and the session rail.
 *
 * The handoff writes these as `86.1k tok · $0.91`, so the shapes here match
 * that rather than a locale-aware formatter.
 */

const THOUSAND = 1_000
const MILLION = 1_000_000

/** Token counts, abbreviated the way the handoff shows them. */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0 tok'
  if (tokens < THOUSAND) return `${Math.round(tokens)} tok`
  if (tokens < MILLION) return `${(tokens / THOUSAND).toFixed(1)}k tok`
  return `${(tokens / MILLION).toFixed(1)}M tok`
}

/**
 * Spend in dollars. Sub-cent amounts round to `$0.00` rather than growing a
 * third decimal, which would not line up with the other cards.
 */
export function formatCost(costUsd: number): string {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return '$0.00'
  return `$${costUsd.toFixed(2)}`
}

/** "3 days ago" — how long ago something happened, in plain words. */
export function relativeTime(ms: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000))
  if (seconds < 60) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
