import { randomUUID } from 'node:crypto'
import type { Db } from '../db'
import type {
  Task,
  TaskComment,
  TaskPriority,
  TaskStatus,
} from '../../../shared/types'
import {
  labelAddedLine,
  labelRemovedLine,
  movedLine,
  pickedUpLine,
  priorityLine,
  unassignedLine,
} from '../../../shared/tasks'

interface TaskRow {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignee_id: string | null
  project_id: string | null
  labels: string
  created_at: number
  updated_at: number
}

interface CommentRow {
  id: string
  task_id: string
  author: string
  tone: 'you' | 'agent'
  text: string
  is_system: number
  created_at: number
}

export interface NewTaskInput {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  assigneeId?: string | null
  projectId?: string | null
  labels?: string[]
}

/** One field of one task, changing. The only thing `apply` accepts. */
export type TaskChange =
  | { field: 'status'; value: TaskStatus }
  | { field: 'priority'; value: TaskPriority }
  | { field: 'assignee'; value: string | null }
  | { field: 'project'; value: string | null }
  | { field: 'title'; value: string }
  | { field: 'description'; value: string }
  | { field: 'addLabel'; value: string }
  | { field: 'removeLabel'; value: string }

/**
 * Who made a change. An agent supplies its own name; the IPC layer supplies
 * "You" for anything the renderer asks for, so a renderer cannot claim to be
 * an agent.
 */
export interface Actor {
  name: string
  tone: 'you' | 'agent'
}

/**
 * How an assignee id becomes a display name. Agents live in agent.toml, not
 * in this database, so the store is handed a lookup rather than reaching for
 * one — which is also what makes it testable without an AgentStore.
 */
export type NameLookup = (agentId: string) => string | null

export type TaskEvent =
  | { type: 'task-created'; task: Task }
  | { type: 'task-updated'; task: Task }
  | { type: 'task-deleted'; taskId: string }
  | { type: 'comment'; taskId: string; comment: TaskComment }

/** Task keys read ROS-101, from a counter that never reuses a number. */
const KEY_PREFIX = 'ROS'
const KEY_COUNTER = 'task_seq'

/**
 * SQLite-backed store for the shared task board.
 *
 * Unlike the other SQLite stores this one publishes changes, because it has
 * two writers: the person at the keyboard, and any agent holding the roster
 * task tools. `sessions.ts` can assume "Roster is the only writer" and this
 * one cannot.
 *
 * Every mutation goes through `apply`, which is also where the History log is
 * written — so a status change made by dragging a card and one made by an
 * agent produce the same sentence.
 */
export class TaskStore {
  private listeners = new Set<(event: TaskEvent) => void>()

  constructor(
    private readonly db: Db,
    private readonly nameFor: NameLookup = () => null,
  ) {}

  subscribe(listener: (event: TaskEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: TaskEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  /* ---- reads ------------------------------------------------------------ */

  findAll(): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks ORDER BY created_at')
      .all() as TaskRow[]
    return rows.map(toTask)
  }

  findById(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | TaskRow
      | undefined
    return row ? toTask(row) : null
  }

  /** The whole thread, both tabs, in the order things happened. */
  comments(taskId: string): TaskComment[] {
    const rows = this.db
      .prepare('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at, rowid')
      .all(taskId) as CommentRow[]
    return rows.map(toComment)
  }

  /* ---- writes ----------------------------------------------------------- */

  create(input: NewTaskInput): Task {
    const now = Date.now()

    const task = this.db.transaction((): Task => {
      const created: Task = {
        id: this.nextKey(),
        title: input.title,
        description: input.description ?? '',
        status: input.status ?? 'todo',
        priority: input.priority ?? 'medium',
        assigneeId: input.assigneeId ?? null,
        projectId: input.projectId ?? null,
        labels: input.labels ?? [],
        createdAt: now,
        updatedAt: now,
      }

      this.db
        .prepare(
          `INSERT INTO tasks
             (id, title, description, status, priority, assignee_id, project_id,
              labels, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          created.id,
          created.title,
          created.description,
          created.status,
          created.priority,
          created.assigneeId,
          created.projectId,
          JSON.stringify(created.labels),
          created.createdAt,
          created.updatedAt,
        )

      return created
    })()

    this.emit({ type: 'task-created', task })
    return task
  }

  delete(id: string): void {
    // Comments go with it through the foreign key.
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    this.emit({ type: 'task-deleted', taskId: id })
  }

  /** A comment someone actually wrote, as opposed to a History entry. */
  comment(taskId: string, input: { author: string; tone: 'you' | 'agent'; text: string }): TaskComment {
    const comment = this.writeComment(taskId, { ...input, isSystem: false })
    this.emit({ type: 'comment', taskId, comment })
    return comment
  }

  /**
   * The one way a task changes.
   *
   * Returns the new task alongside whatever History it generated, so the
   * caller can broadcast both without re-reading. A change that would be a
   * no-op — a label that is already there — writes nothing and logs nothing.
   */
  apply(taskId: string, change: TaskChange, actor: Actor): { task: Task; history: TaskComment[] } {
    const current = this.findById(taskId)
    if (!current) throw new Error(`unknown task "${taskId}"`)

    const { task: next, lines } = this.resolve(current, change, actor)

    // Nothing moved: don't touch updated_at, and don't log a change that
    // did not happen.
    if (isUnchanged(current, next)) return { task: current, history: [] }

    const updated: Task = { ...next, updatedAt: Date.now() }

    const history = this.db.transaction((): TaskComment[] => {
      this.db
        .prepare(
          `UPDATE tasks
              SET title = ?, description = ?, status = ?, priority = ?,
                  assignee_id = ?, project_id = ?, labels = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          updated.title,
          updated.description,
          updated.status,
          updated.priority,
          updated.assigneeId,
          updated.projectId,
          JSON.stringify(updated.labels),
          updated.updatedAt,
          taskId,
        )

      return lines.map((line) =>
        this.writeComment(taskId, {
          author: line.author,
          tone: line.tone,
          text: line.text,
          isSystem: true,
        }),
      )
    })()

    this.emit({ type: 'task-updated', task: updated })
    for (const entry of history) this.emit({ type: 'comment', taskId, comment: entry })

    return { task: updated, history }
  }

  /* ---- the rules -------------------------------------------------------- */

  /**
   * Turns one change into the next task and the History it deserves.
   *
   * Pure apart from the name lookup, and deliberately the only place that
   * decides either — both the board and an agent's `update_task` land here.
   */
  private resolve(
    task: Task,
    change: TaskChange,
    actor: Actor,
  ): { task: Task; lines: HistoryLine[] } {
    const by = (text: string): HistoryLine[] => [
      { author: actor.name, tone: actor.tone, text },
    ]

    switch (change.field) {
      case 'status':
        if (change.value === task.status) return { task, lines: [] }
        return {
          task: { ...task, status: change.value },
          lines: by(movedLine(actor.name, change.value)),
        }

      case 'priority':
        if (change.value === task.priority) return { task, lines: [] }
        return {
          task: { ...task, priority: change.value },
          lines: by(priorityLine(change.value)),
        }

      case 'assignee': {
        if (change.value === task.assigneeId) return { task, lines: [] }

        if (change.value === null) {
          return { task: { ...task, assigneeId: null }, lines: by(unassignedLine()) }
        }

        const name = this.nameFor(change.value) ?? change.value
        // Picking up untouched work starts it — the board should not show a
        // task as "To Do" while somebody is demonstrably on it. The move is
        // silent: one action, one line.
        const status: TaskStatus = task.status === 'todo' ? 'in_progress' : task.status

        return {
          task: { ...task, assigneeId: change.value, status },
          lines: [{ author: name, tone: 'agent', text: pickedUpLine(name) }],
        }
      }

      // Retitling, rewriting and refiling are edits, not events — the
      // prototype logs none of them, and a History full of typo fixes would
      // bury the three lines that matter.
      case 'project':
        return { task: { ...task, projectId: change.value }, lines: [] }

      case 'title':
        return { task: { ...task, title: change.value }, lines: [] }

      case 'description':
        return { task: { ...task, description: change.value }, lines: [] }

      case 'addLabel': {
        if (task.labels.includes(change.value)) return { task, lines: [] }
        return {
          task: { ...task, labels: [...task.labels, change.value] },
          lines: by(labelAddedLine(change.value)),
        }
      }

      case 'removeLabel': {
        if (!task.labels.includes(change.value)) return { task, lines: [] }
        return {
          task: { ...task, labels: task.labels.filter((label) => label !== change.value) },
          lines: by(labelRemovedLine(change.value)),
        }
      }
    }
  }

  /* ---- helpers ---------------------------------------------------------- */

  private writeComment(
    taskId: string,
    input: { author: string; tone: 'you' | 'agent'; text: string; isSystem: boolean },
  ): TaskComment {
    const comment: TaskComment = {
      id: randomUUID(),
      taskId,
      author: input.author,
      tone: input.tone,
      text: input.text,
      isSystem: input.isSystem,
      createdAt: Date.now(),
    }

    this.db
      .prepare(
        `INSERT INTO task_comments (id, task_id, author, tone, text, is_system, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        comment.id,
        comment.taskId,
        comment.author,
        comment.tone,
        comment.text,
        comment.isSystem ? 1 : 0,
        comment.createdAt,
      )

    return comment
  }

  /**
   * The next task key.
   *
   * A counter rather than a count of rows: deleting ROS-3 must not hand the
   * next task the same key, or two things in the History log mean different
   * tasks.
   */
  private nextKey(): string {
    const row = this.db
      .prepare(
        `INSERT INTO counters (name, value) VALUES (?, 1)
         ON CONFLICT (name) DO UPDATE SET value = value + 1
         RETURNING value`,
      )
      .get(KEY_COUNTER) as { value: number }

    return `${KEY_PREFIX}-${row.value}`
  }
}

interface HistoryLine {
  author: string
  tone: 'you' | 'agent'
  text: string
}

/** Compares everything but updatedAt, which is the thing we are deciding. */
function isUnchanged(a: Task, b: Task): boolean {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.status === b.status &&
    a.priority === b.priority &&
    a.assigneeId === b.assigneeId &&
    a.projectId === b.projectId &&
    a.labels.length === b.labels.length &&
    a.labels.every((label, i) => label === b.labels[i])
  )
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    projectId: row.project_id,
    labels: JSON.parse(row.labels) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toComment(row: CommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    author: row.author,
    tone: row.tone,
    text: row.text,
    isSystem: row.is_system === 1,
    createdAt: row.created_at,
  }
}
