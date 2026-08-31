import { useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { TASK_PRIORITIES, type TaskPriority } from '@shared/types'
import { taskPriorityLabel } from '@shared/tasks'
import { Field, Modal, Select, TextInput } from '@/components/primitives'
import { messageFor } from '@/lib/errors'
import { LabelChips } from './TaskFields'
import { ALL_PROJECTS, activeProjects, useRoster, withTask } from '@/state/store'

const NO_PROJECT = 'none'
const UNASSIGNED = 'unassigned'

export function NewTaskModal() {
  const close = () => useRoster.getState().setNewTaskOpen(false)
  const agents = useRoster(useShallow((s) => s.agents))
  // New work never starts in an archived project.
  const projects = useRoster(useShallow(activeProjects))
  // A task created while a project is selected belongs to it — retyping the
  // filter you are already looking at is busywork.
  const filter = useRoster((s) => s.projectFilter)
  // Which button opened this decides what it makes: "New task" a board task,
  // "+ New backlog task" one that starts off the board.
  const status = useRoster((s) => s.newTaskStatus)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState<string>(UNASSIGNED)
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [project, setProject] = useState<string>(
    filter === ALL_PROJECTS ? NO_PROJECT : filter,
  )
  const [labels, setLabels] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(keepOpen: boolean): Promise<void> {
    setSaving(true)
    setError(null)

    try {
      const created = await window.roster.tasks.create({
        title: title.trim(),
        description,
        status,
        priority,
        assigneeId: assignee === UNASSIGNED ? null : assignee,
        projectId: project === NO_PROJECT ? null : project,
        labels,
      })
      useRoster.setState((s) => ({
        // withTask, not a plain append: the broadcast for this same task has
        // usually landed already, and appending again would show it twice.
        tasks: withTask(s.tasks, created),
        // A new backlog task is what you want to be looking at next.
        ...(created.status === 'backlog' ? { backlogSelectedId: created.id } : {}),
      }))
      if (keepOpen) {
        // Assignee, priority, and project carry over — batching a run of
        // similar tasks is the point of staying open.
        setTitle('')
        setDescription('')
        setLabels([])
      } else {
        close()
      }
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      label="New task"
      onClose={close}
      header={<h2 className="m-0 text-2xl font-semibold">New task</h2>}
      footer={
        <>
          <button
            type="button"
            onClick={close}
            className="ml-auto cursor-pointer rounded-pill border border-line-card bg-transparent px-[13px] py-[7px] font-ui text-lg text-ink-3 hover:border-line-hover-strong"
            data-hoverable
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create(true)}
            disabled={saving || title.trim() === ''}
            className="cursor-pointer rounded-pill border border-line-card bg-transparent px-[13px] py-[7px] font-ui text-lg font-semibold text-ink-2 hover:border-line-hover-strong disabled:cursor-default disabled:opacity-50"
            data-hoverable
          >
            {saving ? 'Creating…' : 'Create Another'}
          </button>
          <button
            type="button"
            onClick={() => void create(false)}
            disabled={saving || title.trim() === ''}
            className="cursor-pointer rounded-pill border-0 bg-accent px-[15px] py-[7px] font-ui text-lg font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create task'}
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto p-[18px]">
        <Field label="Title">
          <TextInput
            ariaLabel="Task title"
            placeholder="What needs doing"
            value={title}
            onChange={setTitle}
          />
        </Field>

        <Field label="Description" caption="Markdown is rendered on the task.">
          <textarea
            aria-label="Task description"
            value={description}
            rows={5}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-y rounded-field border border-line-card bg-card px-[10px] py-[8px] font-ui text-md leading-[1.5] text-ink-2 outline-none focus:border-accent-line focus:bg-accent-surface-2"
          />
        </Field>

        <div className="flex gap-[10px]">
          <Field label="Assignee">
            <Select
              ariaLabel="Assignee"
              value={assignee}
              onChange={setAssignee}
              options={[
                { value: UNASSIGNED, label: 'Unassigned' },
                ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
              ]}
            />
          </Field>

          <Field label="Priority">
            <Select
              ariaLabel="Priority"
              value={priority}
              onChange={(value) => setPriority(value as TaskPriority)}
              options={TASK_PRIORITIES.map((value) => ({
                value,
                label: taskPriorityLabel(value),
              }))}
            />
          </Field>

          <Field label="Project">
            <Select
              ariaLabel="Project"
              value={project}
              onChange={setProject}
              options={[
                { value: NO_PROJECT, label: 'No project' },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </Field>
        </div>

        <Field label="Labels">
          <LabelChips
            labels={labels}
            onAdd={(label) => setLabels((current) => [...new Set([...current, label])])}
            onRemove={(label) => setLabels((current) => current.filter((l) => l !== label))}
          />
        </Field>

        {error ? <p className="m-0 text-md text-error">{error}</p> : null}
      </div>
    </Modal>
  )
}
