import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { SessionNudges, NUDGE_PROMPT, NUDGE_PERIOD_MS } from '@main/sessions/nudges'
import { SessionStore } from '@main/store/sessions'
import { TaskStore } from '@main/store/tasks'
import { ProjectStore } from '@main/store/projects'

let db: Db
let sessions: SessionStore
let tasks: TaskStore
let streaming: ReturnType<typeof vi.fn<(sessionId: string) => boolean>>
let enqueue: ReturnType<typeof vi.fn<(sessionId: string, prompt: string) => void>>

beforeEach(() => {
  db = openDatabase(':memory:')
  sessions = new SessionStore(db)
  tasks = new TaskStore(db)
  streaming = vi.fn<(sessionId: string) => boolean>().mockReturnValue(false)
  enqueue = vi.fn<(sessionId: string, prompt: string) => void>()
})

function eligibleSession() {
  const task = tasks.create({
    title: 'Finish liveness checks',
    status: 'in_progress',
    assigneeId: 'debugging',
  })
  const session = sessions.create({
    agentId: 'debugging',
    title: task.title,
    origin: 'you',
    taskId: task.id,
  })
  return { task, session }
}

describe('SessionNudges', () => {
  test('bounds oversized task context while preserving the check-in instruction', () => {
    const task = tasks.create({
      title: 'T'.repeat(100_000),
      description: 'D'.repeat(100_000),
      status: 'in_progress',
      assigneeId: 'debugging',
    })
    for (let index = 0; index < 25; index++) {
      tasks.comment(task.id, {
        author: `Author-${index}`,
        tone: 'you',
        text: `Comment-${index}: ${'C'.repeat(100_000)}`,
      })
    }
    tasks.comment(task.id, { author: 'A'.repeat(100_000), tone: 'you', text: 'Oversized author' })
    new SessionNudges(sessions, { isStreaming: streaming, enqueue }, Date.now, NUDGE_PERIOD_MS, {
      tasks, agentExists: () => true, onAttached: vi.fn(),
    }).tick()
    const prompt = enqueue.mock.calls[0]![1]
    expect(prompt.length).toBeLessThan(27_000)
    expect(prompt).toContain('Comment-24:')
    expect(prompt).not.toContain('Comment-0:')
    expect(prompt).toContain('(truncated)')
    expect(prompt).toContain('earlier comments not shown')
    expect(prompt.endsWith(NUDGE_PROMPT)).toBe(true)
  })

  test('creates a missing assignee session with task context and reuses it', () => {
    const project = new ProjectStore(db).create({ name: 'Recovery', color: '#123456' })
    const task = tasks.create({ title: 'Resume work', description: 'Fix the missing check', status: 'in_progress', assigneeId: 'debugging', projectId: project.id })
    tasks.comment(task.id, { author: 'You', tone: 'you', text: 'Keep the existing cooldown' })
    const onAttached = vi.fn()
    let now = 10_000_000
    const nudges = new SessionNudges(sessions, { isStreaming: streaming, enqueue }, () => now, NUDGE_PERIOD_MS, {
      tasks, agentExists: () => true, onAttached,
    })

    nudges.tick()
    const session = sessions.findByTask(task.id, 'debugging')
    expect(session).not.toBeNull()
    expect(session?.projectId).toBe(project.id)
    expect(enqueue.mock.calls[0]?.[1]).toContain('Your reply is not automatically posted')
    expect(onAttached).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.id, sessionId: session!.id }))
    expect(enqueue).toHaveBeenCalledWith(session!.id, expect.stringContaining(task.description), { author: 'Roster' })
    expect(enqueue).toHaveBeenCalledWith(session!.id, expect.stringContaining('Keep the existing cooldown'), { author: 'Roster' })
    nudges.tick()
    expect(enqueue).toHaveBeenCalledTimes(1)
    now += NUDGE_PERIOD_MS
    nudges.tick()
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(onAttached).toHaveBeenCalledTimes(1)
  })

  test('opens a session for a new assignee without nudging the old one', () => {
    const { task, session } = eligibleSession()
    tasks.apply(task.id, { field: 'assignee', value: 'review' }, { name: 'You', tone: 'you' })
    const onAttached = vi.fn()
    new SessionNudges(sessions, { isStreaming: streaming, enqueue }, Date.now, NUDGE_PERIOD_MS, {
      tasks, agentExists: () => true, onAttached,
    }).tick()
    const replacement = sessions.findByTask(task.id, 'review')
    expect(replacement).not.toBeNull()
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0]?.[0]).toBe(replacement!.id)
    expect(sessions.findById(session.id)?.lastNudgedAt).toBeNull()
  })

  test('does not replace or interrupt an active assignee session', () => {
    const { task, session } = eligibleSession()
    const onAttached = vi.fn()
    streaming.mockReturnValue(true)
    new SessionNudges(sessions, { isStreaming: streaming, enqueue }, Date.now, NUDGE_PERIOD_MS, {
      tasks, agentExists: () => true, onAttached,
    }).tick()
    expect(sessions.findByTask(task.id, 'debugging')?.id).toBe(session.id)
    expect(onAttached).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })

  test.each(['todo', 'backlog', 'in_review', 'done'] as const)('does not create sessions for %s tasks', (status) => {
    const task = tasks.create({ title: 'Not active', status, assigneeId: 'debugging' })
    new SessionNudges(sessions, { isStreaming: streaming, enqueue }, Date.now, NUDGE_PERIOD_MS, {
      tasks, agentExists: () => true, onAttached: vi.fn(),
    }).tick()
    expect(sessions.findByTask(task.id, 'debugging')).toBeNull()
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('skips unassigned tasks and missing agents', () => {
    tasks.create({ title: 'Unassigned', status: 'in_progress' })
    const task = tasks.create({ title: 'Deleted agent', status: 'in_progress', assigneeId: 'missing' })
    new SessionNudges(sessions, { isStreaming: streaming, enqueue }, Date.now, NUDGE_PERIOD_MS, {
      tasks, agentExists: () => false, onAttached: vi.fn(),
    }).tick()
    expect(sessions.findByTask(task.id, 'missing')).toBeNull()
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('does not nudge an existing session whose agent was removed', () => {
    const { session } = eligibleSession()
    new SessionNudges(sessions, { isStreaming: streaming, enqueue }, Date.now, NUDGE_PERIOD_MS, {
      tasks, agentExists: () => false, onAttached: vi.fn(),
    }).tick()
    expect(enqueue).not.toHaveBeenCalled()
    expect(sessions.findById(session.id)?.lastNudgedAt).toBeNull()
  })

  test('asks an inactive assignee to continue or update its in-progress task', () => {
    const now = 10_000_000
    const { session } = eligibleSession()
    const nudges = new SessionNudges(sessions, { isStreaming: streaming, enqueue }, () => now)

    nudges.tick()

    expect(enqueue).toHaveBeenCalledWith(session.id, NUDGE_PROMPT, { author: 'Roster' })
    expect(sessions.findById(session.id)?.lastNudgedAt).toBe(now)
  })

  test('does not interrupt an active turn and leaves it eligible for a later check', () => {
    const now = 10_000_000
    const { session } = eligibleSession()
    streaming.mockReturnValue(true)
    const nudges = new SessionNudges(sessions, { isStreaming: streaming, enqueue }, () => now)

    nudges.tick()

    expect(enqueue).not.toHaveBeenCalled()
    expect(sessions.findById(session.id)?.lastNudgedAt).toBeNull()
  })

  test.each<[string, { status?: 'todo'; assigneeId?: string }]>([
    ['a task that is not in progress', { status: 'todo' as const }],
    ['a task assigned to another agent', { assigneeId: 'review' }],
  ])('does not nudge %s', (_label, changes) => {
    const now = 10_000_000
    const { task } = eligibleSession()
    if (changes.status) tasks.apply(task.id, { field: 'status', value: changes.status }, { name: 'You', tone: 'you' })
    if (changes.assigneeId) tasks.apply(task.id, { field: 'assignee', value: changes.assigneeId }, { name: 'You', tone: 'you' })

    new SessionNudges(sessions, { isStreaming: streaming, enqueue }, () => now).tick()

    expect(enqueue).not.toHaveBeenCalled()
  })

  test('honours the persisted cooldown', () => {
    const now = 10_000_000
    const { session } = eligibleSession()
    const nudges = new SessionNudges(sessions, { isStreaming: streaming, enqueue }, () => now)

    sessions.markNudged(session.id, now - NUDGE_PERIOD_MS + 1)
    nudges.tick()
    expect(enqueue).not.toHaveBeenCalled()

    sessions.markNudged(session.id, now - NUDGE_PERIOD_MS)
    nudges.tick()
    expect(enqueue).toHaveBeenCalledWith(session.id, NUDGE_PROMPT, { author: 'Roster' })
  })

  test('marks before enqueueing, so overlapping checks cannot send twice', () => {
    const now = 10_000_000
    const { session } = eligibleSession()
    const nudges = new SessionNudges(sessions, { isStreaming: streaming, enqueue }, () => now)

    nudges.tick()
    nudges.tick()

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(session.id, NUDGE_PROMPT, { author: 'Roster' })
  })

  test('checks immediately and can be disposed with the app lifecycle', () => {
    const { session } = eligibleSession()
    const nudges = new SessionNudges(sessions, { isStreaming: streaming, enqueue }, () => 10_000_000)

    nudges.start()
    nudges.start()
    nudges.dispose()
    nudges.dispose()

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenCalledWith(session.id, NUDGE_PROMPT, { author: 'Roster' })
  })
})
