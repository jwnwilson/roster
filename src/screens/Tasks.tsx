import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { BOARD_STATUSES, type Task, type BoardStatus } from '@shared/types'
import { taskStatusColor, taskStatusLabel } from '@shared/tasks'
import { PrimaryButton, ScreenHeader, Segmented, TextInput } from '@/components/primitives'
import { ProjectFilter } from '@/components/ProjectFilter'
import { TaskCard, TaskCardBody, type TaskCardProps } from '@/components/TaskCard'
import {
  ALL_PROJECTS,
  agentStatus,
  columnOf,
  columnsFor,
  moveTask,
  selectFilteredTasks,
  useRoster,
  type TaskView,
} from '@/state/store'
import { boardAnnouncements } from '@/state/board'
import { Backlog } from './Backlog'
import { TaskDetailModal } from './TaskDetailModal'
import { NewTaskModal } from './NewTaskModal'
import { ProjectsModal } from './ProjectsModal'
import { NotionModal } from './NotionModal'

/** Backlog sits left of Board, as the handoff draws it. */
const VIEWS: readonly { value: TaskView; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'board', label: 'Board' },
]

export function Tasks() {
  const taskView = useRoster((s) => s.taskView)
  const setTaskView = useRoster((s) => s.setTaskView)
  const tasks = useRoster(useShallow(selectFilteredTasks))
  const total = useRoster((s) => s.tasks.length)
  const inReview = useRoster((s) => s.tasks.filter((t) => t.status === 'in_review').length)
  const taskQuery = useRoster((s) => s.taskQuery)
  const setTaskQuery = useRoster((s) => s.setTaskQuery)
  const projectFilter = useRoster((s) => s.projectFilter)
  const openTaskId = useRoster((s) => s.openTaskId)
  const projectsOpen = useRoster((s) => s.projectsOpen)
  const newTaskOpen = useRoster((s) => s.newTaskOpen)
  const setProjectsOpen = useRoster((s) => s.setProjectsOpen)
  const setNewTaskOpen = useRoster((s) => s.setNewTaskOpen)
  const notionOpen = useRoster((s) => s.notionOpen)
  const setNotionOpen = useRoster((s) => s.setNotionOpen)

  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<Task | null>(null)

  // Grouping here rather than in a selector: a selector returning a freshly
  // built object re-renders forever under zustand v5.
  const columns = useMemo(() => columnsFor(tasks), [tasks])

  const filtering = taskQuery.trim() !== '' || projectFilter !== ALL_PROJECTS
  const summary = filtering
    ? `${tasks.length} of ${total} match`
    : `${total} ${total === 1 ? 'task' : 'tasks'} · ${inReview} in review`

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a plain click still
    // opens the task rather than nudging it.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space alone lifts a card. Enter is left to the card, which uses it
      // to open the task.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  )

  function onDragStart(event: DragStartEvent): void {
    setDragging(tasks.find((task) => task.id === event.active.id) ?? null)
  }

  function onDragEnd(event: DragEndEvent): void {
    setDragging(null)
    const { active, over } = event
    if (!over) return

    const target = columnOf(over.id, tasks)
    if (target === null) return

    setError(null)
    void moveTask(String(active.id), target).then(setError)
  }


  return (
    <div className="flex h-screen flex-col">
      <ScreenHeader title="Tasks">
        <Segmented
          ariaLabel="Tasks view"
          options={VIEWS}
          value={taskView}
          onChange={setTaskView}
        />
        <span className="text-md text-dim">{summary}</span>
        <div className="ml-auto flex items-center gap-[8px]">
          <ProjectFilter />
          <button
            type="button"
            onClick={() => setProjectsOpen(true)}
            className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-ink-3 hover:border-line-hover"
            data-hoverable
          >
            Projects
          </button>
          <button
            type="button"
            onClick={() => setNotionOpen(true)}
            className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-ink-3 hover:border-line-hover"
            data-hoverable
          >
            Notion
          </button>
          <TextInput
            ariaLabel="Filter tasks"
            placeholder="Filter tasks"
            value={taskQuery}
            onChange={setTaskQuery}
            className="w-[200px]"
          />
          <PrimaryButton onClick={() => setNewTaskOpen(true)}>New task</PrimaryButton>
        </div>
      </ScreenHeader>

      {error ? (
        <p className="m-0 border-b border-line px-[18px] py-[8px] text-md text-error">{error}</p>
      ) : null}

      {taskView === 'backlog' ? (
        <Backlog />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          accessibility={{ announcements: boardAnnouncements(tasks) }}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <div className="flex min-h-0 flex-1 gap-[14px] overflow-x-auto px-[18px] py-[16px]">
            {BOARD_STATUSES.map((status) => (
              <Column key={status} status={status} tasks={columns[status]} />
            ))}
          </div>

          <DragOverlay>
            {dragging ? <CardFor task={dragging} render={(p) => <TaskCardBody {...p} />} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {openTaskId ? <TaskDetailModal /> : null}
      {newTaskOpen ? <NewTaskModal /> : null}
      {projectsOpen ? <ProjectsModal /> : null}
      {notionOpen ? <NotionModal /> : null}
    </div>
  )
}

interface ColumnProps {
  status: BoardStatus
  tasks: Task[]
}

function Column({ status, tasks }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const label = taskStatusLabel(status)

  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className="flex min-w-[220px] flex-1 flex-col overflow-hidden rounded-card border bg-rail"
      style={{ borderColor: isOver ? 'var(--color-line-active)' : 'var(--color-line)' }}
    >
      <header className="flex flex-none items-center gap-[8px] border-b border-line px-[13px] py-[11px]">
        <span
          aria-hidden
          className="rounded-full"
          style={{ width: 6, height: 6, background: taskStatusColor(status) }}
        />
        <h2 className="m-0 text-lg font-semibold">{label}</h2>
        <span className="ml-auto font-mono text-sm text-dim-2">{tasks.length}</span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto p-[10px]">
        <SortableContext items={tasks.map((task) => task.id)}>
          {tasks.map((task) => (
            <CardFor key={task.id} task={task} render={(p) => <TaskCard {...p} />} />
          ))}
        </SortableContext>
      </div>
    </section>
  )
}

interface CardForProps {
  task: Task
  render: (props: TaskCardProps) => React.ReactNode
}

/**
 * Resolves everything a card needs from the store, so the card itself stays
 * presentational and the overlay can reuse exactly the same props.
 */
function CardFor({ task, render }: CardForProps) {
  const openTask = useRoster((s) => s.openTask)
  const assignee = useRoster((s) =>
    task.assigneeId === null ? null : (s.agents.find((a) => a.id === task.assigneeId) ?? null),
  )
  const status = useRoster((s) => (assignee ? agentStatus(s, assignee) : 'idle'))
  const project = useRoster(
    (s) => s.projects.find((candidate) => candidate.id === task.projectId) ?? null,
  )
  const commentCount = useRoster(
    (s) => (s.taskComments[task.id] ?? []).filter((comment) => !comment.isSystem).length,
  )

  return render({
    task,
    assigneeName: assignee?.name ?? null,
    assigneeStatus: status,
    project,
    commentCount,
    onOpen: () => openTask(task.id),
  })
}


