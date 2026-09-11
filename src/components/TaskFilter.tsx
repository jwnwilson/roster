import { useShallow } from 'zustand/shallow'
import type { Task } from '@shared/types'
import { Select } from '@/components/primitives'
import { ALL_PROJECTS, ALL_TASKS, useRoster, type RosterState } from '@/state/store'

/**
 * The Workflow view's task filter: which piece of work to follow.
 *
 * Gated on the project filter, as the handoff draws it — an unnarrowed list
 * of every task the roster has ever held is not a thing anyone can pick from,
 * and the disabled option says what it is waiting for rather than leaving an
 * empty control to puzzle over.
 *
 * The gate lifts once a task is already selected, which is how arriving from
 * a task's own "View workflow" button works when that task is filed under no
 * project: the filter is set, so it has to be readable and clearable.
 */
export function TaskFilter() {
  const projectFilter = useRoster((s) => s.projectFilter)
  const value = useRoster((s) => s.workflowTaskId)
  const onChange = useRoster((s) => s.setWorkflowTaskId)
  const tasks = useRoster(useShallow((s) => offeredTasks(s)))

  const disabled = projectFilter === ALL_PROJECTS && value === ALL_TASKS

  return (
    <Select
      ariaLabel="Filter by task"
      value={value}
      onChange={onChange}
      disabled={disabled}
      className="w-[220px]"
      options={[
        { value: ALL_TASKS, label: disabled ? 'Pick a project first' : 'All tasks' },
        ...tasks.map((task) => ({ value: task.id, label: `${task.id} · ${task.title}` })),
      ]}
    />
  )
}

/**
 * The tasks on offer: the picked project's, or all of them.
 *
 * The selected task is kept on the list whatever the project filter says. A
 * native select renders blank on a value it has no option for, and the
 * control would read as filtered by nothing while filtering the graph.
 */
function offeredTasks(state: RosterState): Task[] {
  const { projectFilter, workflowTaskId } = state

  return state.tasks.filter((task) => {
    if (task.id === workflowTaskId) return true
    return projectFilter === ALL_PROJECTS || task.projectId === projectFilter
  })
}
