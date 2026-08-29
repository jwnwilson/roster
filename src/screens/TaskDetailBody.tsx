import { useEffect, useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  type TaskComment,
  type TaskPriority,
  type TaskStatus,
} from '@shared/types'
import { taskPriorityLabel, taskStatusLabel } from '@shared/tasks'
import type { TaskChange } from '@shared/ipc'
import { Markdown } from '@/components/Markdown'
import { SectionLabel, Segmented, Select } from '@/components/primitives'
import { messageFor } from '@/lib/errors'
import { NO_COMMENTS, agentStatus, useRoster, type TaskTab } from '@/state/store'
import { AssigneeField } from '@/components/AssigneeField'
import { LabelChips } from './TaskFields'

const NO_PROJECT = 'none'

/**
 * Everything about one task: title, description, thread, and the rail of
 * fields down the side.
 *
 * Mounted twice — inside the floating modal the board opens, and inline in
 * the Backlog tab's panel. One component rather than two, because the
 * handoff asks for "the exact same editable fields" in both places and two
 * copies would drift the first time either changed.
 */
interface TaskDetailBodyProps {
  task: Task
  /**
   * Print the task's key above the title. The modal shows it in its header
   * bar instead; rendered inline there is no header, so the panel would
   * otherwise never say which task it is.
   */
  showKey?: boolean
}

export function TaskDetailBody({ task, showKey = false }: TaskDetailBodyProps) {
  const setTaskComments = useRoster((s) => s.setTaskComments)
  const agents = useRoster(useShallow((s) => s.agents))
  const projects = useRoster(useShallow((s) => s.projects))
  // A map, not a function: a selector returning a fresh closure re-renders
  // forever under zustand v5, exactly as store.ts warns.
  const statuses = useRoster(
    useShallow((s) =>
      Object.fromEntries(s.agents.map((agent) => [agent.id, agentStatus(s, agent)])),
    ),
  )
  const thread = useRoster(useShallow((s) => s.taskComments[task.id] ?? NO_COMMENTS))

  const [error, setError] = useState<string | null>(null)
  const taskId = task.id

  // The thread is read when the task is opened, not with the board — a
  // hundred cards would otherwise mean a hundred threads nobody asked for.
  useEffect(() => {
    let cancelled = false

    void window.roster.tasks
      .comments(taskId)
      .then((loaded) => {
        if (!cancelled) setTaskComments(taskId, loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageFor(cause))
      })

    return () => {
      cancelled = true
    }
  }, [taskId, setTaskComments])

  async function apply(change: TaskChange): Promise<void> {
    setError(null)

    try {
      const updated = await window.roster.tasks.apply(task.id, change)
      useRoster.setState((s) => ({
        tasks: s.tasks.map((t) => (t.id === updated.id ? updated : t)),
      }))
      // A change usually writes a History line, so re-read the thread.
      setTaskComments(task.id, await window.roster.tasks.comments(task.id))
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[22px] py-[20px]">
        {showKey ? <span className="font-mono text-base text-dim-2">{task.id}</span> : null}

        <Title value={task.title} onSave={(value) => void apply({ field: 'title', value })} />

        <Description
          value={task.description}
          onSave={(value) => void apply({ field: 'description', value })}
        />

        <Thread taskId={task.id} comments={thread} />

        {error ? <p className="m-0 text-md text-error">{error}</p> : null}
      </div>

      <aside className="flex w-task-rail flex-none flex-col gap-[16px] overflow-y-auto border-l border-line bg-rail p-[14px]">
        <Rail label="Status">
          <Select
            ariaLabel="Status"
            value={task.status}
            onChange={(value) => void apply({ field: 'status', value: value as TaskStatus })}
            options={TASK_STATUSES.map((value) => ({ value, label: taskStatusLabel(value) }))}
          />
        </Rail>

        <Rail label="Priority">
          <Select
            ariaLabel="Priority"
            value={task.priority}
            onChange={(value) =>
              void apply({ field: 'priority', value: value as TaskPriority })
            }
            options={TASK_PRIORITIES.map((value) => ({
              value,
              label: taskPriorityLabel(value),
            }))}
          />
        </Rail>

        <Rail label="Assignee">
          <AssigneeField
            agents={agents}
            value={task.assigneeId}
            statuses={statuses}
            onChange={(value) => void apply({ field: 'assignee', value })}
          />
        </Rail>

        <Rail label="Project">
          <Select
            ariaLabel="Project"
            value={task.projectId ?? NO_PROJECT}
            onChange={(value) =>
              void apply({ field: 'project', value: value === NO_PROJECT ? null : value })
            }
            options={[
              { value: NO_PROJECT, label: 'No project' },
              ...projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
          />
        </Rail>

        <Rail label="Labels">
          <LabelChips
            labels={task.labels}
            onAdd={(value) => void apply({ field: 'addLabel', value })}
            onRemove={(value) => void apply({ field: 'removeLabel', value })}
          />
        </Rail>
      </aside>
    </div>
  )
}

function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  )
}

/* ---- title ------------------------------------------------------------- */

interface TitleProps {
  value: string
  onSave: (value: string) => void
}

function Title({ value, onSave }: TitleProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  function save(): void {
    const trimmed = draft.trim()
    // An empty title would leave a card with nothing on it; keep the old one.
    if (trimmed !== '' && trimmed !== value) onSave(trimmed)
    setEditing(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      save()
    }
    if (e.key === 'Escape') {
      // Escape belongs to the title while it is being edited — closing the
      // whole modal would throw the edit away without saying so.
      e.stopPropagation()
      setDraft(value)
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        className="-mx-[6px] -my-[3px] cursor-text rounded-chip border-0 bg-transparent px-[6px] py-[3px] text-left font-ui text-[19px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink hover:bg-accent-surface-2"
        data-hoverable
      >
        {value}
      </button>
    )
  }

  return (
    <input
      type="text"
      autoFocus
      aria-label="Task title"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={onKeyDown}
      className="-mx-[6px] -my-[3px] w-full rounded-chip border border-accent-line bg-accent-surface-2 px-[6px] py-[3px] font-ui text-[19px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink outline-none"
    />
  )
}

/* ---- description -------------------------------------------------------- */

interface DescriptionProps {
  value: string
  onSave: (value: string) => void
}

function Description({ value, onSave }: DescriptionProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        className="-mx-[8px] cursor-text rounded-chip border-0 bg-transparent px-[8px] py-[6px] text-left hover:bg-accent-surface-2"
        data-hoverable
      >
        {value.trim() === '' ? (
          <span className="text-md text-dim">No description. Click to add one.</span>
        ) : (
          <Markdown>{value}</Markdown>
        )}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <textarea
        autoFocus
        aria-label="Task description"
        value={draft}
        rows={8}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        className="w-full resize-y rounded-field border border-line-card bg-card px-[10px] py-[8px] font-mono text-lg leading-[1.6] text-ink-2 outline-none focus:border-accent-line focus:bg-accent-surface-2"
      />
      <div className="flex items-center gap-[8px]">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="ml-auto cursor-pointer rounded-chip border border-line-card bg-transparent px-[11px] py-[5px] font-ui text-base text-ink-3 hover:border-line-hover-strong"
          data-hoverable
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (draft !== value) onSave(draft)
            setEditing(false)
          }}
          className="cursor-pointer rounded-chip border-0 bg-accent px-[12px] py-[5px] font-ui text-base font-semibold text-white hover:bg-accent-hover"
        >
          Save
        </button>
      </div>
    </div>
  )
}

/* ---- comments and history ----------------------------------------------- */

interface ThreadProps {
  taskId: string
  comments: readonly TaskComment[]
}

const TABS = [
  { value: 'comments' as const, label: 'Comments' },
  { value: 'history' as const, label: 'History' },
]

function Thread({ taskId, comments }: ThreadProps) {
  const tab = useRoster((s) => s.taskTab)
  const setTaskTab = useRoster((s) => s.setTaskTab)
  const setTaskComments = useRoster((s) => s.setTaskComments)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)

  const shown = comments.filter((comment) => comment.isSystem === (tab === 'history'))

  async function post(): Promise<void> {
    const body = text.trim()
    if (body === '') return
    setPosting(true)

    try {
      await window.roster.tasks.comment(taskId, body)
      setTaskComments(taskId, await window.roster.tasks.comments(taskId))
      setText('')
    } finally {
      setPosting(false)
    }
  }

  return (
    <section aria-label="Thread" className="flex flex-col gap-[12px]">
      <Segmented<TaskTab>
        ariaLabel="Thread"
        options={TABS}
        value={tab}
        onChange={setTaskTab}
      />

      {shown.length === 0 ? (
        <p className="m-0 text-md text-dim">
          {tab === 'history' ? 'Nothing has changed yet.' : 'No comments yet.'}
        </p>
      ) : (
        <div className="flex flex-col gap-[12px]">
          {shown.map((comment) => (
            <div key={comment.id} className="flex flex-col gap-[4px]">
              <span
                className="text-sm font-medium"
                style={{
                  color:
                    comment.tone === 'agent'
                      ? 'var(--color-accent-light)'
                      : 'var(--color-muted-2)',
                }}
              >
                {comment.author}
              </span>
              <span className="text-md leading-[1.55] text-ink-2">{comment.text}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'comments' ? (
        <div className="flex items-center gap-[8px]">
          <input
            type="text"
            aria-label="Add a comment"
            placeholder="Add a comment"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') void post()
            }}
            className="flex-1 rounded-chip border border-line-card bg-card px-[10px] py-[6px] font-ui text-md text-ink outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2"
          />
          <button
            type="button"
            onClick={() => void post()}
            disabled={posting || text.trim() === ''}
            className="cursor-pointer rounded-chip border-0 bg-accent px-[12px] py-[6px] font-ui text-md font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            Comment
          </button>
        </div>
      ) : null}
    </section>
  )
}
