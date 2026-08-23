import { beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { SessionStore, toLine } from '@main/store/sessions'

let db: Db
let store: SessionStore

beforeEach(() => {
  db = openDatabase(':memory:')
  store = new SessionStore(db)
})

/** Appends with an explicit timestamp, so "most recent" is deterministic. */
function appendAt(sessionId: string, at: number, message: Parameters<SessionStore['append']>[0]) {
  const stored = store.append(message)
  db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(at, stored.id)
  return stored
}

function text(sessionId: string, body: string, role: 'user' | 'assistant' = 'assistant') {
  return {
    sessionId,
    kind: 'text' as const,
    role,
    who: role === 'user' ? 'you' : 'Debugging Agent',
    text: body,
  }
}

describe('recentByAgent — which session it picks', () => {
  test('picks the session holding the newest message, not the newest session', () => {
    const older = store.create({ agentId: 'debug', title: 'Older', origin: 'you' })
    const newer = store.create({ agentId: 'debug', title: 'Newer', origin: 'you' })

    // The newer session was created last but has been quiet since.
    appendAt(newer.id, 1_000, text(newer.id, 'from the newer session'))
    appendAt(older.id, 5_000, text(older.id, 'from the older session'))

    expect(store.recentByAgent()['debug']?.map((l) => l.text)).toEqual([
      'from the older session',
    ])
  })

  test('never mixes lines from two sessions', () => {
    const a = store.create({ agentId: 'debug', title: 'A', origin: 'you' })
    const b = store.create({ agentId: 'debug', title: 'B', origin: 'you' })

    appendAt(a.id, 1_000, text(a.id, 'a-one'))
    appendAt(a.id, 2_000, text(a.id, 'a-two'))
    appendAt(b.id, 9_000, text(b.id, 'b-one'))

    // b holds the newest message, so only b's lines appear.
    expect(store.recentByAgent()['debug']?.map((l) => l.text)).toEqual(['b-one'])
  })

  test('keeps each agent to its own session', () => {
    const d = store.create({ agentId: 'debug', title: 'D', origin: 'you' })
    const r = store.create({ agentId: 'review', title: 'R', origin: 'you' })

    appendAt(d.id, 1_000, text(d.id, 'debug line'))
    appendAt(r.id, 2_000, text(r.id, 'review line'))

    const recent = store.recentByAgent()
    expect(recent['debug']?.map((l) => l.text)).toEqual(['debug line'])
    expect(recent['review']?.map((l) => l.text)).toEqual(['review line'])
  })

  test('omits an agent with no messages rather than listing it empty', () => {
    store.create({ agentId: 'silent', title: 'x', origin: 'you' })
    expect(store.recentByAgent()['silent']).toBeUndefined()
  })

  test('returns nothing at all for an empty roster', () => {
    expect(store.recentByAgent()).toEqual({})
  })
})

describe('recentByAgent — how many, and in what order', () => {
  test('returns the newest four, oldest first', () => {
    const s = store.create({ agentId: 'debug', title: 'x', origin: 'you' })
    for (const [i, body] of ['one', 'two', 'three', 'four', 'five'].entries()) {
      appendAt(s.id, 1_000 + i, text(s.id, body))
    }

    // Reading order on the card: oldest at the top, newest at the bottom.
    expect(store.recentByAgent()['debug']?.map((l) => l.text)).toEqual([
      'two',
      'three',
      'four',
      'five',
    ])
  })

  test('honours a different limit', () => {
    const s = store.create({ agentId: 'debug', title: 'x', origin: 'you' })
    for (const [i, body] of ['a', 'b', 'c'].entries()) appendAt(s.id, 1_000 + i, text(s.id, body))

    expect(store.recentByAgent(2)['debug']?.map((l) => l.text)).toEqual(['b', 'c'])
  })

  test('returns fewer than the limit when that is all there is', () => {
    const s = store.create({ agentId: 'debug', title: 'x', origin: 'you' })
    appendAt(s.id, 1_000, text(s.id, 'only one'))

    expect(store.recentByAgent()['debug']).toHaveLength(1)
  })

  test('breaks a same-millisecond tie by insertion order', () => {
    const s = store.create({ agentId: 'debug', title: 'x', origin: 'you' })
    for (const body of ['first', 'second', 'third']) appendAt(s.id, 5_000, text(s.id, body))

    expect(store.recentByAgent()['debug']?.map((l) => l.text)).toEqual([
      'first',
      'second',
      'third',
    ])
  })
})

describe('toLine — how each message kind reads on a card', () => {
  test('a user message is labelled "you"', () => {
    const line = toLine({
      kind: 'text',
      payload: JSON.stringify({ role: 'user', who: 'you', text: 'Find the leak.' }),
    })

    expect(line).toEqual({ who: 'you', role: 'user', text: 'Find the leak.' })
  })

  test('an assistant message is labelled by role, not by agent name', () => {
    // The card's label column is 52px — an agent name would be truncated.
    const line = toLine({
      kind: 'text',
      payload: JSON.stringify({ role: 'assistant', who: 'Debugging Agent', text: 'Reproduced.' }),
    })

    expect(line).toEqual({ who: 'agent', role: 'agent', text: 'Reproduced.' })
  })

  test('no label is wider than the column can show', () => {
    const kinds = [
      { kind: 'text' as const, payload: JSON.stringify({ role: 'user' }) },
      { kind: 'text' as const, payload: JSON.stringify({ role: 'assistant' }) },
      { kind: 'tool' as const, payload: JSON.stringify({ tool: 'x' }) },
      { kind: 'spawn' as const, payload: JSON.stringify({ text: 'x' }) },
      { kind: 'handoff' as const, payload: JSON.stringify({ links: [] }) },
    ]

    for (const row of kinds) expect(toLine(row).who.length).toBeLessThanOrEqual(8)
  })

  test('a tool call reads as its command', () => {
    const line = toLine({
      kind: 'tool',
      payload: JSON.stringify({ tool: 'run_command', args: 'pytest -k leak' }),
    })

    expect(line).toEqual({ who: 'tool', role: 'tool', text: 'run_command pytest -k leak' })
  })

  test('a multi-line message is truncated to its first line', () => {
    // A card row is one line; the rest would be clipped anyway.
    const line = toLine({
      kind: 'text',
      payload: JSON.stringify({ role: 'assistant', text: 'First line.\nSecond line.' }),
    })

    expect(line.text).toBe('First line.')
  })

  test('leading blank lines are skipped rather than showing an empty row', () => {
    const line = toLine({
      kind: 'text',
      payload: JSON.stringify({ role: 'assistant', text: '\n\n  Actual content.' }),
    })

    expect(line.text).toBe('Actual content.')
  })

  test('a spawn says the session was opened for it', () => {
    const line = toLine({
      kind: 'spawn',
      payload: JSON.stringify({ from: 'Architect Agent', text: 'Reproduce the leak.' }),
    })

    expect(line).toEqual({ who: 'spawned', role: 'agent', text: 'Reproduce the leak.' })
  })

  test('a handoff names what it opened', () => {
    const line = toLine({
      kind: 'handoff',
      payload: JSON.stringify({ links: [{ label: 'Review Agent · PR #482' }] }),
    })

    expect(line.text).toBe('opened Review Agent · PR #482')
  })

  test('a handoff with no links still reads sensibly', () => {
    const line = toLine({ kind: 'handoff', payload: JSON.stringify({ links: [] }) })
    expect(line.text).toBe('opened a session')
  })
})


describe('listAll', () => {
  test('groups every session by its agent', () => {
    store.create({ agentId: 'debug', title: 'One', origin: 'you' })
    store.create({ agentId: 'debug', title: 'Two', origin: 'you' })
    store.create({ agentId: 'review', title: 'Three', origin: 'you' })

    const all = store.listAll()
    expect(all['debug']?.map((s) => s.title)).toEqual(['One', 'Two'])
    expect(all['review']?.map((s) => s.title)).toEqual(['Three'])
  })

  test('omits an agent with no sessions', () => {
    expect(store.listAll()['nobody']).toBeUndefined()
  })

  test('returns nothing for an empty roster', () => {
    expect(store.listAll()).toEqual({})
  })

  test('preserves the spawn origin, which the chip glyph depends on', () => {
    store.create({
      agentId: 'debug',
      title: 'Handed over',
      origin: 'agent',
      from: { agentId: 'architect', sessionId: 'a1', label: 'Architect Agent' },
    })

    expect(store.listAll()['debug']?.[0]).toMatchObject({
      origin: 'agent',
      from: 'Architect Agent',
    })
  })
})
