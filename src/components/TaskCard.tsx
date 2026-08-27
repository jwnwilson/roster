import type { KeyboardEvent } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Project, Status, Task } from '@shared/types'
import { taskPriorityColor, taskPriorityLabel } from '@shared/tasks'
import { Avatar } from './Avatar'

export interface TaskCardProps {
  task: Task
  /** The assignee's display name, or null when unassigned. */
  assigneeName: string | null
  assigneeStatus: Status
  project: Project | null
  commentCount: number
  onOpen: () => void
}

/**
 * One card on the board, draggable.
 *
 * A single focusable element does both jobs: Enter opens the task, Space
 * lifts it for a keyboard drag. That split is why the card is a `div` with
 * `role="button"` rather than a real `<button>` — a native button activates
 * on Space too, which would fight the drag sensor for the same key.
 */
export function TaskCard(props: TaskCardProps) {
  const { task, onOpen } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      onOpen()
      return
    }
    // Everything else — Space to lift, arrows to move — belongs to the
    // drag sensor.
    listeners?.['onKeyDown']?.(e)
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        // The lifted copy is what the overlay draws; leave a gap behind it
        // rather than two cards saying the same thing.
        opacity: isDragging ? 0 : 1,
      }}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={onOpen}
      aria-label={`${task.id}: ${task.title}`}
    >
      <TaskCardBody {...props} />
    </div>
  )
}

/** The card's looks, with no behaviour — what the drag overlay renders. */
export function TaskCardBody({
  task,
  assigneeName,
  assigneeStatus,
  project,
  commentCount,
}: TaskCardProps) {
  return (
    <div
      title={`${task.id} — ${taskPriorityLabel(task.priority)}`}
      className="flex w-full cursor-pointer flex-col gap-[8px] rounded-field border border-line bg-card px-[11px] py-[10px] text-left hover:border-line-hover"
      style={{ borderLeft: `2px solid ${taskPriorityColor(task.priority)}` }}
      data-hoverable
    >
      <span className="font-mono text-xs text-dim-2">{task.id}</span>
      <span className="text-lg leading-[1.4] text-ink">{task.title}</span>

      {task.labels.length > 0 ? (
        <span className="flex flex-wrap items-center gap-[6px]">
          {task.labels.map((label) => (
            <span
              key={label}
              className="rounded-[10px] bg-[#1a1c23] px-[7px] py-[2px] text-2xs text-muted-2"
            >
              {label}
            </span>
          ))}
        </span>
      ) : null}

      <span className="flex items-center gap-[8px]">
        <Avatar name={assigneeName} status={assigneeStatus} />

        {project ? (
          <span className="flex items-center gap-[5px] text-xs text-muted-2">
            <span
              aria-hidden
              className="rounded-full"
              style={{ width: 6, height: 6, background: project.color }}
            />
            {project.name}
          </span>
        ) : null}

        {commentCount > 0 ? (
          <span className="ml-auto font-mono text-xs text-faint-2">
            {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
          </span>
        ) : null}
      </span>
    </div>
  )
}
