import type { Status } from '@shared/types'
import { statusColor } from '@shared/status'
import { initialsFor } from '@shared/tasks'

interface AvatarProps {
  /** The agent's display name, or null when nobody is assigned. */
  name: string | null
  status?: Status
  size?: number
}

/**
 * The assignee chip on a task card: initials in a ring coloured by what that
 * agent is doing. An unassigned task keeps the ring — an empty slot reads as
 * "nobody yet" rather than as missing chrome.
 */
export function Avatar({ name, status = 'idle', size = 18 }: AvatarProps) {
  const assigned = name !== null

  return (
    <span
      title={name ?? 'Unassigned'}
      className="flex flex-none items-center justify-center rounded-chip font-ui font-semibold text-ink-3"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.47),
        background: assigned ? 'var(--color-line-active)' : 'transparent',
        border: `1px solid ${assigned ? statusColor(status) : 'var(--color-off)'}`,
      }}
    >
      {assigned ? initialsFor(name) : '—'}
    </span>
  )
}
