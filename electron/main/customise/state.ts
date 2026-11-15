export type CustomisationStatus = 'provisioning' | 'ready' | 'failed'
export type StatusEvent = 'start' | 'succeed' | 'fail'

/**
 * The only moves a copy's status may make. `ready` has none: a working copy
 * is changed by its agents and by Manage, never re-provisioned underneath
 * them. A failed copy is retried, which is the one way back to provisioning.
 */
const MOVES: Record<CustomisationStatus, Partial<Record<StatusEvent, CustomisationStatus>>> = {
  provisioning: { succeed: 'ready', fail: 'failed' },
  failed: { start: 'provisioning' },
  ready: {},
}

export function nextStatus(current: CustomisationStatus, event: StatusEvent): CustomisationStatus {
  const next = MOVES[current][event]
  if (next === undefined) throw new Error(`A copy that is ${current} cannot ${event}.`)
  return next
}
