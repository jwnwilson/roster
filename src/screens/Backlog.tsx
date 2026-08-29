import { useEffect } from 'react'
import { useShallow } from 'zustand/shallow'
import { TASK_PRIORITIES, type Project, type Task } from '@shared/types'
import { taskPriorityColor, taskPriorityLabel } from '@shared/tasks'
import { Select, TextInput } from '@/components/primitives'
import { ProjectFilter } from '@/components/ProjectFilter'
import {
  ALL_PRIORITIES,
  projectById,
  selectBacklogTasks,
  useRoster,
} from '@/state/store'
import { TaskDetailBody } from './TaskDetailBody'

/**
 * The Backlog tab: ideas and work nobody is ready to schedule.
 *
 * A list rather than a board, because the whole point is that these have not
 * been sorted into columns yet. The only way onto the board is the Status
 * select in the panel — there is deliberately no drag path, so nothing lands
 * on the board by accident.
 */
export function Backlog() {
  const tasks = useRoster(useShallow(selectBacklogTasks))
  const backlogQuery = useRoster((s) => s.backlogQuery)
  const setBacklogQuery = useRoster((s) => s.setBacklogQuery)
  const backlogPriority = useRoster((s) => s.backlogPriority)
  const setBacklogPriority = useRoster((s) => s.setBacklogPriority)
  const selectedId = useRoster((s) => s.backlogSelectedId)
  const selectBacklogTask = useRoster((s) => s.selectBacklogTask)
  const setNewTaskOpen = useRoster((s) => s.setNewTaskOpen)

  // Whatever is selected has to be something still in the list: filtering it
  // away, or an agent moving it onto the board, would otherwise leave the
  // panel showing a task the list no longer offers.
  const selected = tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null
  const selectedKey = selected?.id ?? null

  useEffect(() => {
    if (selectedKey !== null && selectedKey !== selectedId) selectBacklogTask(selectedKey)
  }, [selectedKey, selectedId, selectBacklogTask])

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[220px] flex-none flex-col border-r border-line">
        <div className="flex flex-none flex-col gap-[8px] border-b border-line px-[12px] py-[10px]">
          <TextInput
            ariaLabel="Filter backlog"
            placeholder="Filter backlog"
            value={backlogQuery}
            onChange={setBacklogQuery}
          />

          <div className="flex gap-[6px]">
            {/* The same filter the header and the grid use, deliberately: it
                is on screen twice here, and two values would read as a bug. */}
            <ProjectFilter className="min-w-0 flex-1" compact />
            <Select
              ariaLabel="Filter by priority"
              className="min-w-0 flex-1"
              compact
              value={backlogPriority}
              onChange={setBacklogPriority}
              options={[
                { value: ALL_PRIORITIES, label: 'All priorities' },
                ...TASK_PRIORITIES.map((value) => ({
                  value,
                  label: taskPriorityLabel(value),
                })),
              ]}
            />
          </div>

          <button
            type="button"
            onClick={() => setNewTaskOpen(true, 'backlog')}
            className="cursor-pointer rounded-chip border-0 bg-accent py-[5px] text-center font-ui text-md font-semibold text-white hover:bg-accent-hover"
          >
            + New backlog task
          </button>
        </div>

        <div
          role="listbox"
          aria-label="Backlog"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {tasks.length === 0 ? (
            <p className="m-0 px-[12px] py-[24px] text-center text-md text-label">
              No backlog tasks.
            </p>
          ) : (
            tasks.map((task) => (
              <BacklogRow
                key={task.id}
                task={task}
                selected={task.id === selected?.id}
                onSelect={() => selectBacklogTask(task.id)}
              />
            ))
          )}
        </div>
      </div>

      {selected ? (
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <TaskDetailBody task={selected} showKey />
        </div>
      ) : null}
    </div>
  )
}

interface BacklogRowProps {
  task: Task
  selected: boolean
  onSelect: () => void
}

/**
 * One row. Not a TaskCard: the handoff drops the avatar, the labels and the
 * comment count here, because a backlog is scanned rather than worked.
 */
function BacklogRow({ task, selected, onSelect }: BacklogRowProps) {
  const project = useRoster((s) => projectById(s, task.projectId))

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      title={`${task.id} — ${taskPriorityLabel(task.priority)}`}
      className={`flex w-full cursor-pointer flex-col items-start gap-[3px] border-0 border-b border-l-2 border-b-[#1a1c23] px-[12px] py-[10px] text-left ${
        selected ? 'bg-accent-surface-2' : 'bg-transparent hover:bg-accent-surface-2'
      }`}
      style={{ borderLeftColor: taskPriorityColor(task.priority) }}
      data-hoverable
    >
      <span className="font-mono text-2xs text-dim-2">{task.id}</span>
      <span className="text-lg leading-[1.4] text-ink-2">{task.title}</span>
      {project ? <ProjectLine project={project} /> : null}
    </button>
  )
}

function ProjectLine({ project }: { project: Project }) {
  return (
    <span className="mt-[2px] flex items-center gap-[5px] text-xs text-muted-2">
      <span
        aria-hidden
        className="h-[6px] w-[6px] flex-none rounded-full"
        style={{ background: project.color }}
      />
      {project.name}
    </span>
  )
}
