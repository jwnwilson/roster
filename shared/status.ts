import type { Status } from './types'

/**
 * The single source for how a status renders. Colours come from the design
 * handoff's Status vocabulary; labels are its exact wording.
 */
interface StatusStyle {
  /** Tailwind text/background colour token name. */
  token: string
  /** CSS custom property, for inline dot/border colours. */
  cssVar: string
  label: string
}

const STYLES: Record<Status, StatusStyle> = {
  running: { token: 'accent', cssVar: 'var(--color-accent)', label: 'running' },
  approval: { token: 'amber', cssVar: 'var(--color-amber)', label: 'needs you' },
  done: { token: 'done', cssVar: 'var(--color-done)', label: 'finished' },
  idle: { token: 'faint-2', cssVar: 'var(--color-faint-2)', label: 'idle' },
  error: { token: 'error', cssVar: 'var(--color-error)', label: 'error' },
}

export function statusColor(status: Status): string {
  return STYLES[status].cssVar
}

export function statusLabel(status: Status): string {
  return STYLES[status].label
}

export function statusToken(status: Status): string {
  return STYLES[status].token
}

/**
 * The transcript preview on a grid card fades older lines. The handoff
 * specifies an opacity ramp from 1.0 down to a 0.45 floor, 0.16 per step.
 */
export function transcriptOpacity(index: number, total: number): number {
  return Math.max(0.45, 1 - (total - 1 - index) * 0.16)
}

/**
 * The status an agent shows, given its own state and its sessions'.
 *
 * An agent has no activity of its own — its sessions do — so the dot rolls
 * theirs up. Order is by how much it wants your attention:
 *
 *   error    the runner is missing or logged out, so nothing can run at all
 *   approval a session is blocked waiting on you
 *   running  a turn is in flight
 *   done     work finished and nothing needs you
 *   idle     nothing has happened yet
 */
export function rollUpAgentStatus(
  agentStatus: Status,
  sessionStatuses: readonly Status[],
): Status {
  // Being unable to run outranks anything a past session did.
  if (agentStatus === 'error') return 'error'

  const has = (status: Status): boolean => sessionStatuses.includes(status)

  if (has('approval')) return 'approval'
  if (has('running')) return 'running'
  if (has('error')) return 'error'
  if (has('done')) return 'done'
  return 'idle'
}
