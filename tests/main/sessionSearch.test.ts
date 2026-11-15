import { beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { SessionStore } from '@main/store/sessions'

let db: Db
let sessions: SessionStore

beforeEach(() => {
  db = openDatabase(':memory:')
  sessions = new SessionStore(db)
})

/** Marks where a match starts and ends in a snippet; see the store. */
const OPEN = '\uE000'
const CLOSE = '\uE001'

function say(sessionId: string, body: string, role: 'user' | 'assistant' = 'assistant') {
  return sessions.append({
    sessionId,
    kind: 'text',
    role,
    who: role === 'user' ? 'you' : 'Implementer',
    text: body,
  } as never)
}

/** Appends with an explicit timestamp, so "most recent" is deterministic. */
function sayAt(sessionId: string, at: number, body: string) {
  const stored = say(sessionId, body)
  db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(at, stored.id)
  return stored
}

describe('searching transcript text', () => {
  test('finds a word in a message and names its session and agent', () => {
    const session = sessions.create({ agentId: 'implementer', title: 'Kettle', origin: 'you' })
    say(session.id, 'Fill the kettle with white vinegar and boil it.')

    const hits = sessions.search('vinegar')

    expect(hits).toEqual([
      expect.objectContaining({
        sessionId: session.id,
        agentId: 'implementer',
        matches: 1,
        archived: false,
      }),
    ])
    expect(hits[0]?.snippet).toContain(`${OPEN}vinegar${CLOSE}`)
  })

  test('is case-insensitive and matches a prefix of the last word', () => {
    const session = sessions.create({ agentId: 'implementer', title: 'Crash', origin: 'you' })
    say(session.id, 'A Stack Overflow happens in recursion.')

    expect(sessions.search('STACK')).toHaveLength(1)
    expect(sessions.search('recurs')).toHaveLength(1)
  })

  test('treats every word as required, in any order', () => {
    const session = sessions.create({ agentId: 'implementer', title: 'Kettle', origin: 'you' })
    say(session.id, 'Descale the kettle with vinegar.')

    expect(sessions.search('vinegar kettle')).toHaveLength(1)
    expect(sessions.search('vinegar lighthouse')).toEqual([])
  })

  test('reads query syntax as plain text, so punctuation and operators cannot break it', () => {
    const session = sessions.create({ agentId: 'implementer', title: 'Odd', origin: 'you' })
    say(session.id, 'Use NOT and "quotes" and col:value here.')

    expect(() => sessions.search('"unbalanced')).not.toThrow()
    expect(() => sessions.search('NOT (')).not.toThrow()
    expect(() => sessions.search('col:value*')).not.toThrow()
    expect(sessions.search('"quotes"')).toHaveLength(1)
  })

  test('an empty or whitespace query finds nothing', () => {
    const session = sessions.create({ agentId: 'implementer', title: 'Empty', origin: 'you' })
    say(session.id, 'Some words.')

    expect(sessions.search('')).toEqual([])
    expect(sessions.search('   ')).toEqual([])
  })

  test('counts matching messages per session and shows the most recent one', () => {
    const session = sessions.create({ agentId: 'implementer', title: 'Repeat', origin: 'you' })
    sayAt(session.id, 100, 'first kettle note')
    sayAt(session.id, 200, 'nothing relevant')
    sayAt(session.id, 300, 'latest kettle note')

    const [hit] = sessions.search('kettle')

    expect(hit?.matches).toBe(2)
    expect(hit?.snippet).toContain(`${OPEN}kettle${CLOSE}`)
    expect(hit?.snippet).toContain('latest')
    expect(hit?.lastMatchAt).toBe(300)
  })

  test('orders sessions by their most recent match, newest first', () => {
    const older = sessions.create({ agentId: 'implementer', title: 'Older', origin: 'you' })
    const newer = sessions.create({ agentId: 'review', title: 'Newer', origin: 'you' })
    sayAt(older.id, 100, 'a kettle')
    sayAt(newer.id, 500, 'another kettle')

    expect(sessions.search('kettle').map((hit) => hit.sessionId)).toEqual([newer.id, older.id])
  })

  test('leaves archived sessions out unless asked for them', () => {
    const live = sessions.create({ agentId: 'implementer', title: 'Live', origin: 'you' })
    const put = sessions.create({ agentId: 'implementer', title: 'Put away', origin: 'you' })
    say(live.id, 'kettle now')
    say(put.id, 'kettle then')
    sessions.setArchived(put.id, true)

    expect(sessions.search('kettle').map((hit) => hit.sessionId)).toEqual([live.id])

    const withArchived = sessions.search('kettle', { includeArchived: true })
    expect(withArchived.map((hit) => hit.sessionId).sort()).toEqual([live.id, put.id].sort())
    expect(withArchived.find((hit) => hit.sessionId === put.id)?.archived).toBe(true)
  })

  test('indexes what was said by either side, and a handed-off brief', () => {
    const session = sessions.create({ agentId: 'implementer', title: 'Brief', origin: 'agent' })
    say(session.id, 'question about lighthouses', 'user')
    sessions.append({
      sessionId: session.id,
      kind: 'spawn',
      from: 'Tech Lead',
      text: 'Please check the lighthouse notes.',
    } as never)

    expect(sessions.search('lighthouses')).toHaveLength(1)
    expect(sessions.search('lighthouse')).toHaveLength(1)
  })

  test('does not index tool calls, whose arguments are deferred for now', () => {
    const session = sessions.create({ agentId: 'implementer', title: 'Tool', origin: 'you' })
    sessions.append({
      sessionId: session.id,
      kind: 'tool',
      tool: 'bash',
      args: 'grep zeppelin',
      output: 'zeppelin',
      isError: false,
    } as never)

    expect(sessions.search('zeppelin')).toEqual([])
  })

  test('a message edited as it streams is found by what it now says, not what it said', () => {
    const session = sessions.create({ agentId: 'implementer', title: 'Stream', origin: 'you' })
    const stored = say(session.id, 'partial draft')
    expect(sessions.search('draft')).toHaveLength(1)

    sessions.update({ ...stored, text: 'finished answer' } as never)

    expect(sessions.search('draft')).toEqual([])
    expect(sessions.search('finished')).toHaveLength(1)
  })

  test('deleting a session takes its text out of the index with it', () => {
    const session = sessions.create({ agentId: 'implementer', title: 'Gone', origin: 'you' })
    say(session.id, 'unique phrase flamingo')
    expect(sessions.search('flamingo')).toHaveLength(1)

    sessions.delete(session.id)

    expect(sessions.search('flamingo')).toEqual([])
  })

  test('a database that already had messages is indexed when it is migrated', () => {
    // Covered by the migration itself: the backfill runs over existing rows.
    // Here, the index agrees with the messages table after many writes.
    const session = sessions.create({ agentId: 'implementer', title: 'Many', origin: 'you' })
    for (let i = 0; i < 5; i++) say(session.id, `entry ${i} kettle`)

    const indexed = (db.prepare('SELECT COUNT(*) AS n FROM message_search').get() as { n: number }).n
    expect(indexed).toBe(5)
  })
})
