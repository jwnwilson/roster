import { beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { SessionStore } from '@main/store/sessions'

let db: Db
let store: SessionStore

beforeEach(() => {
  db = openDatabase(':memory:')
  store = new SessionStore(db)
})

describe('migrations', () => {
  test('bring a fresh database to the latest version', () => {
    const [row] = db.pragma('user_version') as { user_version: number }[]
    expect(row?.user_version).toBeGreaterThan(0)
  })

  test('are idempotent when run again', () => {
    const before = db.pragma('user_version')
    openDatabase(':memory:')
    expect(db.pragma('user_version')).toEqual(before)
  })
})

describe('SessionStore.create', () => {
  test('creates a user-opened session', () => {
    const session = store.create({ agentId: 'debug', title: 'Session leak', origin: 'you' })

    expect(session.id).toMatch(/[0-9a-f-]{36}/)
    expect(session.status).toBe('idle')
    expect(session.spawnedFrom).toBeUndefined()
  })

  test('records where an agent-opened session came from', () => {
    const session = store.create({
      agentId: 'debug',
      title: 'Session leak',
      origin: 'agent',
      from: { agentId: 'architect', sessionId: 'arch-1', label: 'Architect Agent · ADR-014' },
    })

    expect(session.origin).toBe('agent')
    expect(session.from).toBe('Architect Agent · ADR-014')
    expect(session.spawnedFrom).toEqual({
      agentId: 'architect',
      sessionId: 'arch-1',
      label: 'Architect Agent · ADR-014',
    })
  })

  test('files a session under a project when one is given', () => {
    const session = store.create({
      agentId: 'debug',
      title: 'Session leak',
      origin: 'you',
      projectId: 'proj-reliability',
    })

    expect(session.projectId).toBe('proj-reliability')
    expect(store.findById(session.id)?.projectId).toBe('proj-reliability')
  })

  test('leaves a session unfiled when no project is given', () => {
    const session = store.create({ agentId: 'debug', title: 'Session leak', origin: 'you' })
    expect(session.projectId).toBeNull()
  })

  test('round-trips the spawn origin through the database', () => {
    const created = store.create({
      agentId: 'debug',
      title: 'Migration dry-run',
      origin: 'agent',
      from: { agentId: 'architect', sessionId: 'arch-1', label: 'Architect Agent' },
    })

    expect(store.findById(created.id)).toEqual(created)
  })
})

describe('SessionStore.listByAgent', () => {
  test('returns only that agent, oldest first', () => {
    store.create({ agentId: 'debug', title: 'First', origin: 'you' })
    store.create({ agentId: 'review', title: 'Other agent', origin: 'you' })
    store.create({ agentId: 'debug', title: 'Second', origin: 'you' })

    expect(store.listByAgent('debug').map((s) => s.title)).toEqual(['First', 'Second'])
  })

  test('returns an empty list for an agent with no sessions', () => {
    expect(store.listByAgent('nobody')).toEqual([])
  })
})

describe('SessionStore — mutations', () => {
  test('updates status', () => {
    const s = store.create({ agentId: 'debug', title: 'x', origin: 'you' })
    store.updateStatus(s.id, 'approval')

    expect(store.findById(s.id)?.status).toBe('approval')
  })

  test('attaches the runner session id used for resume and fork', () => {
    const s = store.create({ agentId: 'debug', title: 'x', origin: 'you' })
    store.attachRunnerSession(s.id, 'runner-abc')

    expect(store.findById(s.id)?.runnerSessionId).toBe('runner-abc')
  })

  test('renames', () => {
    const s = store.create({ agentId: 'debug', title: 'Untitled', origin: 'you' })
    store.rename(s.id, 'Session leak on 504')

    expect(store.findById(s.id)?.title).toBe('Session leak on 504')
  })
})

describe('SessionStore — messages', () => {
  test('round-trips a text message', () => {
    const s = store.create({ agentId: 'debug', title: 'x', origin: 'you' })
    store.append({
      sessionId: s.id,
      kind: 'text',
      role: 'assistant',
      who: 'Debugging Agent',
      text: 'Reproduced the leak.',
    })

    const [message] = store.messages(s.id)
    expect(message).toMatchObject({
      kind: 'text',
      role: 'assistant',
      who: 'Debugging Agent',
      text: 'Reproduced the leak.',
    })
  })

  test('round-trips a tool message with its output', () => {
    const s = store.create({ agentId: 'debug', title: 'x', origin: 'you' })
    store.append({
      sessionId: s.id,
      kind: 'tool',
      tool: 'run_command',
      args: 'pytest -k leak',
      output: '1 passed in 8.31s',
      isError: false,
      durationMs: 8_400,
    })

    const [message] = store.messages(s.id)
    expect(message).toMatchObject({ kind: 'tool', tool: 'run_command', durationMs: 8_400 })
  })

  test('round-trips a handoff message with its links', () => {
    const s = store.create({ agentId: 'architect', title: 'x', origin: 'you' })
    store.append({
      sessionId: s.id,
      kind: 'handoff',
      links: [
        { agentId: 'debug', sessionId: 'd1', label: 'Debugging Agent · leak', status: 'approval' },
      ],
    })

    const [message] = store.messages(s.id)
    expect(message).toMatchObject({
      kind: 'handoff',
      links: [{ agentId: 'debug', status: 'approval' }],
    })
  })

  test('returns messages in insertion order even within the same millisecond', () => {
    const s = store.create({ agentId: 'debug', title: 'x', origin: 'you' })
    for (const text of ['one', 'two', 'three']) {
      store.append({ sessionId: s.id, kind: 'text', role: 'user', who: 'you', text })
    }

    const texts = store.messages(s.id).map((m) => (m.kind === 'text' ? m.text : ''))
    expect(texts).toEqual(['one', 'two', 'three'])
  })

  test('scopes messages to their session', () => {
    const a = store.create({ agentId: 'debug', title: 'a', origin: 'you' })
    const b = store.create({ agentId: 'debug', title: 'b', origin: 'you' })
    store.append({ sessionId: a.id, kind: 'text', role: 'user', who: 'you', text: 'in a' })

    expect(store.messages(b.id)).toEqual([])
  })

  test('deleting a session removes its messages', () => {
    const s = store.create({ agentId: 'debug', title: 'x', origin: 'you' })
    store.append({ sessionId: s.id, kind: 'text', role: 'user', who: 'you', text: 'hi' })

    store.delete(s.id)

    expect(store.messages(s.id)).toEqual([])
  })
})

describe('SessionStore — sessions attached to a task', () => {
  function task(id: string): void {
    db.prepare(
      'INSERT INTO tasks (id, title, status, priority, labels, created_at, updated_at)' +
        ` VALUES ('${id}', 'Fix pool leak', 'todo', 'medium', '[]', 0, 0)`,
    ).run()
  }

  test('records the task a session was opened from', () => {
    task('ROS-1')

    const session = store.create({
      agentId: 'debugging',
      title: 'ROS-1 — Fix pool leak',
      origin: 'you',
      taskId: 'ROS-1',
    })

    expect(session.taskId).toBe('ROS-1')
    expect(store.findById(session.id)?.taskId).toBe('ROS-1')
  })

  test('an ordinary session is attached to no task', () => {
    const session = store.create({ agentId: 'debugging', title: 'x', origin: 'you' })

    expect(session.taskId).toBeNull()
  })

  test('finds the session an agent already has on a task', () => {
    task('ROS-1')
    const created = store.create({
      agentId: 'debugging',
      title: 'ROS-1 — Fix pool leak',
      origin: 'you',
      taskId: 'ROS-1',
    })

    expect(store.findByTask('ROS-1', 'debugging')?.id).toBe(created.id)
  })

  test('finds nothing for an agent that has not been mentioned on it', () => {
    task('ROS-1')

    expect(store.findByTask('ROS-1', 'review')).toBeNull()
  })

  test('lists every session attached to a task, oldest first', () => {
    task('ROS-1')
    const first = store.create({ agentId: 'debugging', title: 'a', origin: 'you', taskId: 'ROS-1' })
    const second = store.create({ agentId: 'review', title: 'b', origin: 'you', taskId: 'ROS-1' })

    expect(store.linksForTask('ROS-1')).toEqual([
      { taskId: 'ROS-1', agentId: 'debugging', sessionId: first.id, createdAt: first.createdAt },
      { taskId: 'ROS-1', agentId: 'review', sessionId: second.id, createdAt: second.createdAt },
    ])
  })

  test('lists nothing for a task nobody has been mentioned on', () => {
    task('ROS-1')

    expect(store.linksForTask('ROS-1')).toEqual([])
  })
})
