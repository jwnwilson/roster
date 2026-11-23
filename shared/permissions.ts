/**
 * The macOS privacy permissions Roster and the sessions it runs depend on.
 *
 * Shared because the card that asks for them is in the renderer and the
 * service that reads and requests them is in the main process, and both have
 * to agree on which kinds exist.
 */
export type PermissionKind = 'screen' | 'accessibility' | 'microphone'

export type PermissionStatus =
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'unknown'
  /** Not macOS, so there is no such permission to have. */
  | 'not-applicable'

export type PermissionReport = Record<PermissionKind, PermissionStatus>

export const PERMISSION_KINDS: readonly PermissionKind[] = ['screen', 'accessibility', 'microphone']

export interface PermissionCopy {
  label: string
  /** What the permission lets a session do, in a sentence a user can weigh. */
  purpose: string
  /** Sessions cannot do their job without it. Everything else is optional. */
  required: boolean
}

export const PERMISSION_COPY: Record<PermissionKind, PermissionCopy> = {
  screen: {
    label: 'Screen Recording',
    purpose: 'Lets a session take screenshots with screencapture. Without it, other windows come out missing.',
    required: true,
  },
  accessibility: {
    label: 'Accessibility',
    purpose: 'Lets the roster-desktop helper send keyboard input for the local desktop test.',
    required: false,
  },
  microphone: {
    label: 'Microphone',
    purpose: 'Voice input in the composer.',
    required: false,
  },
}

/** Narrows a value that came from the renderer, which is untrusted input. */
export function isPermissionKind(value: unknown): value is PermissionKind {
  return typeof value === 'string' && (PERMISSION_KINDS as readonly string[]).includes(value)
}
