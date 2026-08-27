import type { Announcements } from '@dnd-kit/core'
import type { Task } from '@shared/types'
import { taskStatusLabel } from '@shared/tasks'
import { columnOf } from './store'

/**
 * What a screen reader hears while a card is being dragged.
 *
 * dnd-kit ships defaults, but they talk in sortable positions — "moved to
 * position 2 of 5" — which is meaningless on a board where the column is the
 * only thing that matters. These say where the card actually went.
 */
export function boardAnnouncements(tasks: readonly Task[]): Announcements {
  const columnFor = (overId: string | number | undefined): string | null => {
    if (overId === undefined) return null
    const status = columnOf(overId, tasks)
    return status === null ? null : taskStatusLabel(status)
  }

  return {
    onDragStart: ({ active }) => `Picked up ${String(active.id)}.`,

    onDragOver: ({ active, over }) => {
      const column = columnFor(over?.id)
      // Nothing under the cursor is not worth announcing — it would fire on
      // every pixel of travel between columns.
      if (column === null) return undefined
      return `${String(active.id)} is over ${column}.`
    },

    onDragEnd: ({ active, over }) => {
      const column = columnFor(over?.id)
      if (column === null) return `${String(active.id)} was dropped where it started.`
      return `${String(active.id)} moved to ${column}.`
    },

    onDragCancel: ({ active }) => `${String(active.id)} was left where it was.`,
  }
}
