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
