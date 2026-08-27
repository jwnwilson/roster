import { beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { TaskStore, type TaskEvent } from '@main/store/tasks'
import { ProjectStore } from '@main/store/projects'

const YOU = { name: 'You', tone: 'you' } as const
const AGENT = { name: 'Debugging Agent', tone: 'agent' } as const

const NAMES: Record<string, string> = {
  debug: 'Debugging Agent',
  review: 'Review Agent',
}

let db: Db
let tasks: TaskStore

beforeEach(() => {
  db = openDatabase(':memory:')
  tasks = new TaskStore(db, (id) => NAMES[id] ?? null)
})

/** History is what the store wrote; comments are what people wrote. */
function history(taskId: string): string[] {
  return tasks
    .comments(taskId)
    .filter((c) => c.isSystem)
    .map((c) => c.text)
}

describe('TaskStore.create', () => {
  test('gives a task a readable key and sensible defaults', () => {
    const task = tasks.create({ title: 'Investigate flaky auth test' })

    expect(task.id).toBe('ROS-1')
    expect(task).toMatchObject({
      title: 'Investigate flaky auth test',
      description: '',
      status: 'todo',
      priority: 'medium',
      assigneeId: null,
      projectId: null,
      labels: [],
    })
  })

  test('keeps everything it was given', () => {
    const task = tasks.create({
      title: 'Fix pool leak',
      description: '# Steps\n\n- reproduce',
      status: 'in_review',
      priority: 'urgent',
      assigneeId: 'debug',
      labels: ['bug', 'api'],
    })

    expect(tasks.findById(task.id)).toEqual(task)
  })

  test('hands out keys in order', () => {
    expect(tasks.create({ title: 'a' }).id).toBe('ROS-1')
    expect(tasks.create({ title: 'b' }).id).toBe('ROS-2')
    expect(tasks.create({ title: 'c' }).id).toBe('ROS-3')
  })

  test('never reuses the key of a deleted task', () => {
    // Two History logs referring to "ROS-2" must mean the same task.
    const first = tasks.create({ title: 'a' })
    tasks.delete(first.id)

    expect(tasks.create({ title: 'b' }).id).toBe('ROS-2')
  })
})

describe('TaskStore.delete', () => {
  test('takes the task thread with it', () => {
    const task = tasks.create({ title: 'a' })
    tasks.comment(task.id, { author: 'you', tone: 'you', text: 'a note' })

    tasks.delete(task.id)

    expect(tasks.findById(task.id)).toBeNull()
    expect(tasks.comments(task.id)).toHaveLength(0)
  })
})

describe('TaskStore.apply — status', () => {
  test('moves the task and logs who moved it', () => {
    const task = tasks.create({ title: 'a' })

    const { task: moved } = tasks.apply(task.id, { field: 'status', value: 'in_review' }, YOU)

    expect(moved.status).toBe('in_review')
    expect(history(task.id)).toEqual(['You moved this to In Review.'])
  })

  test('attributes the move to the agent when an agent made it', () => {
    const task = tasks.create({ title: 'a' })

    tasks.apply(task.id, { field: 'status', value: 'done' }, AGENT)

    expect(history(task.id)).toEqual(['Debugging Agent moved this to Done.'])
  })

  test('moving to the column it is already in changes and logs nothing', () => {
    const task = tasks.create({ title: 'a', status: 'todo' })

    const { task: same, history: lines } = tasks.apply(
      task.id,
      { field: 'status', value: 'todo' },
      YOU,
    )

    expect(same.updatedAt).toBe(task.updatedAt)
    expect(lines).toHaveLength(0)
    expect(history(task.id)).toEqual([])
  })

  test('refuses a task that does not exist', () => {
    expect(() => tasks.apply('ROS-99', { field: 'status', value: 'done' }, YOU)).toThrow(
      'unknown task "ROS-99"',
    )
  })
})

describe('TaskStore.apply — assignee', () => {
  test('reads as the agent claiming the work, using its display name', () => {
    const task = tasks.create({ title: 'a' })

    tasks.apply(task.id, { field: 'assignee', value: 'review' }, YOU)

    // Logged as the agent, not as whoever clicked — the sentence says who
    // is now on it.
    expect(history(task.id)).toEqual(['Review Agent picked up this task.'])
  })

  test('starts an untouched task, because someone is demonstrably on it', () => {
    const task = tasks.create({ title: 'a', status: 'todo' })

    const { task: assigned } = tasks.apply(task.id, { field: 'assignee', value: 'debug' }, YOU)

    expect(assigned.status).toBe('in_progress')
  })

  test('but leaves a task that is already further along where it is', () => {
    const task = tasks.create({ title: 'a', status: 'in_review' })

    const { task: assigned } = tasks.apply(task.id, { field: 'assignee', value: 'debug' }, YOU)

    expect(assigned.status).toBe('in_review')
  })

  test('the auto-start is silent — one action, one line', () => {
    const task = tasks.create({ title: 'a', status: 'todo' })

    tasks.apply(task.id, { field: 'assignee', value: 'debug' }, YOU)

    expect(history(task.id)).toEqual(['Debugging Agent picked up this task.'])
  })

  test('clearing an assignee says so without naming anyone', () => {
    const task = tasks.create({ title: 'a', assigneeId: 'debug' })

    const { task: cleared } = tasks.apply(task.id, { field: 'assignee', value: null }, YOU)

    expect(cleared.assigneeId).toBeNull()
    expect(history(task.id)).toEqual(['Unassigned.'])
  })

  test('falls back to the raw id when the agent is gone', () => {
    const task = tasks.create({ title: 'a' })

    tasks.apply(task.id, { field: 'assignee', value: 'deleted-agent' }, YOU)

    expect(history(task.id)).toEqual(['deleted-agent picked up this task.'])
  })
})

describe('TaskStore.apply — priority and labels', () => {
  test('a priority change spells the new priority out', () => {
    const task = tasks.create({ title: 'a', priority: 'low' })

    tasks.apply(task.id, { field: 'priority', value: 'urgent' }, YOU)

    expect(history(task.id)).toEqual(['Changed priority to Urgent.'])
  })

  test('adding a label appends it and logs it', () => {
    const task = tasks.create({ title: 'a', labels: ['bug'] })

    const { task: labelled } = tasks.apply(task.id, { field: 'addLabel', value: 'api' }, YOU)

    expect(labelled.labels).toEqual(['bug', 'api'])
    expect(history(task.id)).toEqual(['Added label api.'])
  })

  test('adding a label it already has is a no-op with no History line', () => {
    const task = tasks.create({ title: 'a', labels: ['bug'] })

    const { task: same, history: lines } = tasks.apply(
      task.id,
      { field: 'addLabel', value: 'bug' },
      YOU,
    )

    expect(same.labels).toEqual(['bug'])
    expect(lines).toHaveLength(0)
  })

  test('removing a label drops it and logs it', () => {
    const task = tasks.create({ title: 'a', labels: ['bug', 'api'] })

    const { task: labelled } = tasks.apply(task.id, { field: 'removeLabel', value: 'bug' }, YOU)

    expect(labelled.labels).toEqual(['api'])
    expect(history(task.id)).toEqual(['Removed label bug.'])
  })

  test('removing a label it never had logs nothing', () => {
    const task = tasks.create({ title: 'a', labels: [] })

    const { history: lines } = tasks.apply(task.id, { field: 'removeLabel', value: 'x' }, YOU)

    expect(lines).toHaveLength(0)
  })
})

describe('TaskStore.apply — edits that are not events', () => {
  test('retitling changes the task but writes no History', () => {
    const task = tasks.create({ title: 'Old' })

    const { task: renamed } = tasks.apply(task.id, { field: 'title', value: 'New' }, YOU)

    // A History full of typo fixes would bury the lines that matter.
    expect(renamed.title).toBe('New')
    expect(history(task.id)).toEqual([])
  })

  test('rewriting the description writes no History', () => {
    const task = tasks.create({ title: 'a' })

    const { task: edited } = tasks.apply(
      task.id,
      { field: 'description', value: '## Plan' },
      YOU,
    )

    expect(edited.description).toBe('## Plan')
    expect(history(task.id)).toEqual([])
  })

  test('refiling into a project writes no History', () => {
    const projects = new ProjectStore(db)
    const project = projects.create({ name: 'P', color: 'a' })
    const task = tasks.create({ title: 'a' })

    const { task: filed } = tasks.apply(
      task.id,
      { field: 'project', value: project.id },
      YOU,
    )

    expect(filed.projectId).toBe(project.id)
    expect(history(task.id)).toEqual([])
  })
})

describe('TaskStore — comments and history', () => {
  test('keeps what people wrote apart from what the store generated', () => {
    const task = tasks.create({ title: 'a' })
    tasks.comment(task.id, { author: 'you', tone: 'you', text: 'Please prioritise.' })
    tasks.apply(task.id, { field: 'status', value: 'in_progress' }, YOU)

    const all = tasks.comments(task.id)
    expect(all.filter((c) => !c.isSystem).map((c) => c.text)).toEqual(['Please prioritise.'])
    expect(all.filter((c) => c.isSystem).map((c) => c.text)).toEqual([
      'You moved this to In Progress.',
    ])
  })

  test('returns the thread in the order things happened', () => {
    const task = tasks.create({ title: 'a' })
    tasks.comment(task.id, { author: 'you', tone: 'you', text: 'first' })
    tasks.comment(task.id, { author: 'you', tone: 'you', text: 'second' })
    tasks.comment(task.id, { author: 'you', tone: 'you', text: 'third' })

    expect(tasks.comments(task.id).map((c) => c.text)).toEqual(['first', 'second', 'third'])
  })
})

describe('TaskStore — change events', () => {
  test('publishes creations, updates, comments and deletions', () => {
    const seen: TaskEvent[] = []
    tasks.subscribe((event) => seen.push(event))

    const task = tasks.create({ title: 'a' })
    tasks.apply(task.id, { field: 'priority', value: 'high' }, YOU)
    tasks.comment(task.id, { author: 'you', tone: 'you', text: 'hi' })
    tasks.delete(task.id)

    expect(seen.map((e) => e.type)).toEqual([
      'task-created',
      'task-updated',
      'comment', // the History line the priority change wrote
      'comment', // the one someone typed
      'task-deleted',
    ])
  })

  test('an agent changing a task reaches the board like any other change', () => {
    const seen: TaskEvent[] = []
    const task = tasks.create({ title: 'a' })
    tasks.subscribe((event) => seen.push(event))

    tasks.apply(task.id, { field: 'status', value: 'done' }, AGENT)

    const updated = seen.find((e) => e.type === 'task-updated')
    expect(updated).toBeDefined()
  })

  test('a no-op change publishes nothing', () => {
    const task = tasks.create({ title: 'a', priority: 'high' })
    const seen: TaskEvent[] = []
    tasks.subscribe((event) => seen.push(event))

    tasks.apply(task.id, { field: 'priority', value: 'high' }, YOU)

    expect(seen).toHaveLength(0)
  })

  test('unsubscribing stops delivery', () => {
    const seen: TaskEvent[] = []
    const stop = tasks.subscribe((event) => seen.push(event))
    stop()

    tasks.create({ title: 'a' })

    expect(seen).toHaveLength(0)
  })
})
