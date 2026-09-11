import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { SessionNudges, NUDGE_PROMPT, NUDGE_PERIOD_MS } from '@main/sessions/nudges'
import { SessionStore } from '@main/store/sessions'
import { TaskStore } from '@main/store/tasks'

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

  test.each([
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
