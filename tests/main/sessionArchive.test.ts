import { beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { SessionStore } from '@main/store/sessions'
import { UsageStore } from '@main/store/usage'

let db: Db
let sessions: SessionStore

beforeEach(() => {
  db = openDatabase(':memory:')
  sessions = new SessionStore(db)
})

function aSession(agentId = 'debugging', title = 'Work') {
  return sessions.create({ agentId, title, origin: 'you' })
}

describe('archiving a session', () => {
  test('a new session is not archived', () => {
    expect(aSession().archivedAt).toBeNull()
  })

  test('setArchived stamps the time and restoring clears it', () => {
    const session = aSession()

    const archived = sessions.setArchived(session.id, true)
    expect(archived.archivedAt).toEqual(expect.any(Number))
    expect(sessions.findById(session.id)?.archivedAt).toBe(archived.archivedAt)

    const restored = sessions.setArchived(session.id, false)
    expect(restored.archivedAt).toBeNull()
  })

  test('is refused for a session that is gone', () => {
    expect(() => sessions.setArchived('ghost', true)).toThrow(/unknown session/)
  })

  test('drops archived sessions from every sidebar-facing read', () => {
    const kept = aSession('debugging', 'Kept')
    const hidden = aSession('debugging', 'Hidden')
    sessions.append({ sessionId: hidden.id, kind: 'text', role: 'assistant', who: 'Debugging', text: 'latest words' })
    sessions.setArchived(hidden.id, true)

    expect(sessions.listByAgent('debugging').map((s) => s.id)).toEqual([kept.id])
    expect(sessions.listAll()['debugging']?.map((s) => s.id)).toEqual([kept.id])
    expect(Object.values(sessions.recentByAgent()).flat().map((line) => line.text)).not.toContain(
      'latest words',
    )
  })

  test('leaves archived sessions out of the liveness check-in', () => {
    db.prepare(
      `INSERT INTO tasks (id, title, status, priority, assignee_id, created_at, updated_at)
       VALUES ('T-1', 'Task', 'in_progress', 'medium', 'debugging', 0, 0)`,
    ).run()
    const session = sessions.create({ agentId: 'debugging', title: 'On task', origin: 'you', taskId: 'T-1' })
    expect(sessions.livenessCandidates(Date.now()).map((s) => s.id)).toContain(session.id)

    sessions.setArchived(session.id, true)
    expect(sessions.livenessCandidates(Date.now())).toEqual([])
  })

  test('listArchived returns only archived sessions, most recently archived first', () => {
    const first = aSession('debugging', 'First')
    const second = aSession('review', 'Second')
    aSession('debugging', 'Active')
    sessions.setArchived(first.id, true)
    db.prepare('UPDATE sessions SET archived_at = 1 WHERE id = ?').run(first.id)
    sessions.setArchived(second.id, true)
    db.prepare('UPDATE sessions SET archived_at = 2 WHERE id = ?').run(second.id)

    expect(sessions.listArchived().map((s) => s.id)).toEqual([second.id, first.id])
  })

  test('findByTask still finds an archived session, so a mention can reopen it', () => {
    db.prepare(
      `INSERT INTO tasks (id, title, status, priority, created_at, updated_at)
       VALUES ('T-2', 'Task', 'todo', 'medium', 0, 0)`,
    ).run()
    const session = sessions.create({ agentId: 'debugging', title: 'T-2', origin: 'you', taskId: 'T-2' })
    sessions.setArchived(session.id, true)

    expect(sessions.findByTask('T-2', 'debugging')?.id).toBe(session.id)
  })

  test('spend totals keep counting an archived session', () => {
    const session = aSession()
    const usage = new UsageStore(db)
    usage.record({ sessionId: session.id, inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.25 })

    sessions.setArchived(session.id, true)

    expect(usage.summary().byAgent['debugging']?.costUsd).toBe(0.25)
    expect(usage.summary().byAgent['debugging']?.tokens).toBe(15)
  })
})
