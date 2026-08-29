import { Modal } from '@/components/primitives'
import { selectOpenTask, useRoster } from '@/state/store'
import { TaskDetailBody } from './TaskDetailBody'

/**
 * The floating task detail a board card opens.
 *
 * Only the chrome lives here. The contents are TaskDetailBody, which the
 * Backlog tab renders inline instead of in a popup.
 */
export function TaskDetailModal() {
  const task = useRoster(selectOpenTask)
  const closeTask = useRoster((s) => s.closeTask)

  if (!task) return null

  return (
    <Modal
      label={`${task.id}: ${task.title}`}
      onClose={closeTask}
      maxWidth={800}
      fixedHeight
      header={<span className="font-mono text-base text-dim-2">{task.id}</span>}
    >
      <TaskDetailBody task={task} />
    </Modal>
  )
}
