import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { removeSession, type SessionRemovalDeps } from '@main/sessions/remove'
import { PlanStore } from '@main/store/plans'
import { planDir } from '@main/store/paths'
import { SessionStore } from '@main/store/sessions'
import { TaskStore } from '@main/store/tasks'
import { UsageStore } from '@main/store/usage'

let home: string
let db: Db
let sessions: SessionStore
let plans: PlanStore
let usage: UsageStore
let tasks: TaskStore
let stopTurn: Mock<(sessionId: string) => Promise<void>>
let closeTerminal: Mock<(sessionId: string) => void>
let deps: SessionRemovalDeps

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-remove-'))
  process.env['ROSTER_HOME'] = home

  db = openDatabase(':memory:')
  sessions = new SessionStore(db)
  plans = new PlanStore(db)
  usage = new UsageStore(db)
  tasks = new TaskStore(db, () => null)

  stopTurn = vi.fn<(sessionId: string) => Promise<void>>().mockResolvedValue(undefined)
  closeTerminal = vi.fn<(sessionId: string) => void>()
  deps = { sessions, plans, stopTurn, closeTerminal }
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

function aStoredSession(title = 'Session leak') {
  return sessions.create({ agentId: 'debugging', title, origin: 'you' })
}

/** Approvals have no store; the cascade is checked against the table itself. */
function approvalCount(sessionId: string): number {
  const row = db
    .prepare<[string], { total: number }>(
      'SELECT COUNT(*) AS total FROM approvals WHERE session_id = ?',
    )
    .get(sessionId)
  return row?.total ?? 0
}

describe('removeSession', () => {
  test('returns the session it removed', async () => {
    const session = aStoredSession()

    const removed = await removeSession(deps, session.id)

    expect(removed).toEqual(session)
    expect(sessions.findById(session.id)).toBeNull()
  })

  test('reports nothing for a session that is already gone', async () => {
    expect(await removeSession(deps, 'ghost')).toBeNull()
    expect(stopTurn).not.toHaveBeenCalled()
    expect(closeTerminal).not.toHaveBeenCalled()
  })

  test('takes the transcript with it', async () => {
    const session = aStoredSession()
    sessions.append({ sessionId: session.id, kind: 'text', role: 'user', who: 'you', text: 'hi' })

    await removeSession(deps, session.id)

    expect(sessions.messages(session.id)).toEqual([])
  })

  test('takes its usage row with it, so Spend stops counting it', async () => {
    const session = aStoredSession()
    usage.record({
      sessionId: session.id,
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      costUsd: 0.5,
    })

    await removeSession(deps, session.id)

    expect(usage.forSession(session.id)).toBeNull()
    expect(usage.summary().byAgent).toEqual({})
  })

  test('takes pending approvals with it', async () => {
    const session = aStoredSession()
    db.prepare(
      `INSERT INTO approvals (id, session_id, tool_name, command, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run('appr-1', session.id, 'Bash', 'rm -rf /', Date.now())

    await removeSession(deps, session.id)

    expect(approvalCount(session.id)).toBe(0)
  })

  test('takes its plans, their threads and their files with it', async () => {
    const session = aStoredSession()
    const plan = plans.capture({
      sessionId: session.id,
      agentId: 'debugging',
      body: '# Archive projects\n\nAdd a column.',
    })
    plans.comment(plan.id, { author: 'You', tone: 'you', text: 'Use a timestamp.' })
    expect(existsSync(planDir(plan.id))).toBe(true)

    await removeSession(deps, session.id)

    expect(plans.findById(plan.id)).toBeNull()
    expect(plans.comments(plan.id)).toEqual([])
    expect(existsSync(planDir(plan.id))).toBe(false)
  })

  test('detaches it from the task that opened it', async () => {
    const task = tasks.create({ title: 'Fix the leak' })
    const session = sessions.create({
      agentId: 'debugging',
      title: 'Fix the leak',
      origin: 'agent',
      taskId: task.id,
    })
    expect(sessions.linksForTask(task.id)).toHaveLength(1)

    await removeSession(deps, session.id)

    expect(sessions.linksForTask(task.id)).toEqual([])
    // The task itself is not collateral: only the session went.
    expect(tasks.findById(task.id)).not.toBeNull()
  })

  test('stops the turn in flight before the row goes', async () => {
    const session = aStoredSession()
    let existedWhenStopped: boolean | null = null
    stopTurn.mockImplementation(async () => {
      existedWhenStopped = sessions.findById(session.id) !== null
    })

    await removeSession(deps, session.id)

    expect(stopTurn).toHaveBeenCalledWith(session.id)
    expect(existedWhenStopped).toBe(true)
  })

  test('kills the terminal the session was holding', async () => {
    const session = aStoredSession()

    await removeSession(deps, session.id)

    expect(closeTerminal).toHaveBeenCalledWith(session.id)
  })

  test('leaves every other session alone', async () => {
    const doomed = aStoredSession('Doomed')
    const kept = aStoredSession('Kept')
    sessions.append({ sessionId: kept.id, kind: 'text', role: 'user', who: 'you', text: 'hi' })

    await removeSession(deps, doomed.id)

    expect(sessions.listByAgent('debugging')).toEqual([kept])
    expect(sessions.messages(kept.id)).toHaveLength(1)
  })

  test('still removes the row when a plan folder cannot be deleted', async () => {
    const session = aStoredSession()
    plans.capture({ sessionId: session.id, agentId: 'debugging', body: '# Plan\n\nDo it.' })
    const failing = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const boom = { ...deps, removeDirectory: () => Promise.reject(new Error('EPERM')) }

    await expect(removeSession(boom, session.id)).resolves.toEqual(session)

    expect(sessions.findById(session.id)).toBeNull()
    // Reported rather than swallowed: the row is gone, the file is not.
    expect(failing).toHaveBeenCalledWith(expect.stringContaining('EPERM'))
    failing.mockRestore()
  })
})
