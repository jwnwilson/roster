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
