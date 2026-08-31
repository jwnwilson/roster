import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDatabase } from '@main/db'
import { PlanStore, type PlanEvent } from '@main/store/plans'
import { planDir } from '@main/store/paths'

const V1 = '# Archive projects\n\nArchiving keeps the row.\n'
const V2 = '# Archive projects\n\nArchiving keeps the row and its tasks.\n'

let home: string
let db: ReturnType<typeof openDatabase>
let plans: PlanStore

/** A session to hang plans off — the foreign key is real. */
function insertSession(id: string): void {
  db.prepare(
    'INSERT INTO sessions (id, agent_id, title, origin, status, created_at)' +
      " VALUES (?, 'debugging', 'Work', 'you', 'idle', 0)",
  ).run(id)
}

function capture(body: string, sessionId = 's1') {
  return plans.capture({ sessionId, agentId: 'debugging', body })
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-plans-'))
  process.env['ROSTER_HOME'] = home
  db = openDatabase(':memory:')
  plans = new PlanStore(db)
  insertSession('s1')
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  db.close()
  await rm(home, { recursive: true, force: true })
})

describe('capturing a plan', () => {
  test('writes the body as a file and keeps only metadata in the row', async () => {
    const plan = capture(V1)

    expect(plan).toMatchObject({
      sessionId: 's1',
      agentId: 'debugging',
      title: 'Archive projects',
      status: 'draft',
      version: 1,
    })
    await expect(readFile(join(planDir(plan.id), 'v1.md'), 'utf8')).resolves.toBe(V1)
  })

  test('titles it from the opening heading, without the markdown', () => {
    // The banner shows the raw line; a modal header should not read "##".
    expect(capture('## Do the thing\n\nsteps').title).toBe('Do the thing')
  })

  test('falls back to a name when there is no heading to take', () => {
    expect(capture('   \n\n').title).toBe('Untitled plan')
  })

  test('a rewrite becomes the next version, and the old one stays on disk', async () => {
    const first = capture(V1)
    const second = capture(V2)

    expect(second.id).toBe(first.id)
    expect(second.version).toBe(2)
    expect(plans.body(second.id)).toBe(V2)
    // The agent rewriting your plan is exactly when you want the old one back.
    await expect(readFile(join(planDir(first.id), 'v1.md'), 'utf8')).resolves.toBe(V1)
  })

  test('a rewrite says so in the thread, in the agent’s name', () => {
    const plan = capture(V1)
    capture(V2)

    expect(plans.comments(plan.id)).toEqual([
      expect.objectContaining({ tone: 'agent', text: 'Revised the plan — v2.', version: 2 }),
    ])
  })

  test('a rewrite brings it back for review', () => {
    const plan = capture(V1)
    plans.setStatus(plan.id, 'revising')

    expect(capture(V2).status).toBe('draft')
  })

  test('the same body twice is one plan, not two versions', () => {
    const first = capture(V1)
    const again = capture(V1)

    // A plan reaches the store from both the approval callback and the tool
    // stream event. The second must not manufacture a v2.
    expect(again).toEqual(first)
    expect(plans.listBySession('s1')).toHaveLength(1)
    expect(plans.comments(first.id)).toEqual([])
  })

  test('a different session gets its own plan', () => {
    insertSession('s2')
    const first = capture(V1)
    const other = plans.capture({ sessionId: 's2', agentId: 'review', body: V1 })

    expect(other.id).not.toBe(first.id)
    expect(plans.listBySession('s2')).toHaveLength(1)
  })
})

describe('reading plans back', () => {
  test('lists a session’s plans oldest first', () => {
    insertSession('s2')
    const mine = capture(V1)
    plans.capture({ sessionId: 's2', agentId: 'review', body: '# Other\n' })

    expect(plans.listBySession('s1').map((p) => p.id)).toEqual([mine.id])
  })

  test('returns nothing for a plan that does not exist', () => {
    expect(plans.findById('nope')).toBeNull()
  })

  test('refuses to read the body of a plan that does not exist', () => {
    expect(() => plans.body('nope')).toThrow('unknown plan "nope"')
  })
})

describe('the thread on a plan', () => {
  test('stamps a note with the version it was written against', () => {
    const plan = capture(V1)
    capture(V2)

    const note = plans.comment(plan.id, { author: 'You', tone: 'you', text: 'use a timestamp' })

    // A note about v2 must not read as a note about v3.
    expect(note).toMatchObject({ planId: plan.id, author: 'You', tone: 'you', version: 2 })
  })

  test('keeps the thread in the order things happened', () => {
    const plan = capture(V1)
    plans.comment(plan.id, { author: 'You', tone: 'you', text: 'first' })
    plans.comment(plan.id, { author: 'You', tone: 'you', text: 'second' })

    expect(plans.comments(plan.id).map((c) => c.text)).toEqual(['first', 'second'])
  })

  test('refuses a plan that does not exist', () => {
    expect(() =>
      plans.comment('nope', { author: 'You', tone: 'you', text: 'hi' }),
    ).toThrow('unknown plan "nope"')
  })
})

describe('moving a plan on', () => {
  test('records the branch the build was told to use', () => {
    const plan = capture(V1)

    const building = plans.setStatus(plan.id, 'building', { branch: 'roster/plan-abc-archive' })

    expect(building).toMatchObject({ status: 'building', branch: 'roster/plan-abc-archive' })
    expect(plans.findById(plan.id)?.branch).toBe('roster/plan-abc-archive')
  })

  test('a pull request is the end of it', () => {
    const plan = capture(V1)
    plans.setStatus(plan.id, 'building', { branch: 'roster/plan-abc-archive' })

    const reviewed = plans.recordPullRequest(plan.id, {
      url: 'https://github.com/o/r/pull/31',
    })

    expect(reviewed).toMatchObject({
      status: 'in_review',
      prUrl: 'https://github.com/o/r/pull/31',
      // Not sent again, so it must survive from the approval.
      branch: 'roster/plan-abc-archive',
    })
  })

  test('a pull request can name the branch it actually came from', () => {
    const plan = capture(V1)

    const reviewed = plans.recordPullRequest(plan.id, {
      url: 'https://github.com/o/r/pull/31',
      branch: 'somewhere/else',
    })

    expect(reviewed.branch).toBe('somewhere/else')
  })

  test('refuse a plan that does not exist', () => {
    expect(() => plans.setStatus('nope', 'building')).toThrow('unknown plan "nope"')
    expect(() => plans.recordPullRequest('nope', { url: 'x' })).toThrow('unknown plan "nope"')
  })
})

describe('what the rest of the app hears about', () => {
  function recorded(): PlanEvent[] {
    const seen: PlanEvent[] = []
    plans.subscribe((event) => seen.push(event))
    return seen
  }

  test('a new plan, a revision and a status change all announce themselves', () => {
    const seen = recorded()

    const plan = capture(V1)
    capture(V2)
    plans.setStatus(plan.id, 'building')

    expect(seen.filter((e) => e.type === 'plan-updated')).toHaveLength(3)
  })

  test('an identical capture announces nothing — nothing changed', () => {
    capture(V1)
    const seen = recorded()

    capture(V1)

    expect(seen).toEqual([])
  })

  test('a note reaches an open modal the way a task comment does', () => {
    const plan = capture(V1)
    const seen = recorded()

    const note = plans.comment(plan.id, { author: 'You', tone: 'you', text: 'hi' })

    expect(seen).toContainEqual({ type: 'comment', planId: plan.id, comment: note })
  })

  test('unsubscribing stops it', () => {
    const seen: PlanEvent[] = []
    const stop = plans.subscribe((event) => seen.push(event))
    stop()

    capture(V1)

    expect(seen).toEqual([])
  })
})
