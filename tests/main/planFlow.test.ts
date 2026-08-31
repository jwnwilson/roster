import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Approval } from '@shared/types'
import { openDatabase } from '@main/db'
import { PlanStore } from '@main/store/plans'
import { PlanFlow } from '@main/sessions/planFlow'
import { branchFor, worktreeFor } from '@main/sessions/planPrompt'

const BODY = '# Archive projects\n\nArchiving keeps the row.\n'

let home: string
let repo: string
let db: ReturnType<typeof openDatabase>
let plans: PlanStore
let flow: PlanFlow
let pending: Approval[]
let cwd: string | null

const manager = {
  pendingApprovals: vi.fn(() => pending),
  respondToApproval: vi.fn(),
  enqueue: vi.fn(),
}

function planAwaitingReview() {
  db.prepare(
    'INSERT INTO sessions (id, agent_id, title, origin, status, created_at)' +
      " VALUES ('s1', 'debugging', 'Work', 'you', 'idle', 0)",
  ).run()
  return plans.capture({ sessionId: 's1', agentId: 'debugging', body: BODY })
}

/** The blocked ExitPlanMode the agent is sitting on while you read its plan. */
function planApproval(): Approval {
  return {
    id: 'a1',
    sessionId: 's1',
    toolName: 'ExitPlanMode',
    command: '# Archive projects',
    status: 'pending',
    createdAt: 0,
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-planflow-'))
  repo = join(home, 'repo')
  await mkdir(join(repo, '.git'), { recursive: true })
  process.env['ROSTER_HOME'] = home
  db = openDatabase(':memory:')
  plans = new PlanStore(db)
  flow = new PlanFlow(plans, manager as never, () => cwd)
  pending = []
  // A real repository by default; the guard is exercised on its own below.
  cwd = repo
  manager.respondToApproval.mockClear()
  manager.enqueue.mockClear()
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  db.close()
  await rm(home, { recursive: true, force: true })
})

describe('sending comments back', () => {
  test('files the note in your name', () => {
    const plan = planAwaitingReview()

    flow.submit(plan.id, 'use a nullable timestamp')

    expect(plans.comments(plan.id)).toContainEqual(
      expect.objectContaining({ author: 'You', tone: 'you', text: 'use a nullable timestamp' }),
    )
  })

  test('answers the blocked call rather than starting a second turn', () => {
    const plan = planAwaitingReview()
    pending = [planApproval()]

    flow.submit(plan.id, 'use a nullable timestamp')

    // The agent is already sitting in plan mode waiting on this exact call;
    // the notes reach it as the reason it was refused.
    expect(manager.respondToApproval).toHaveBeenCalledWith('s1', 'a1', {
      approved: false,
      reason: expect.stringContaining('use a nullable timestamp'),
    })
    expect(manager.enqueue).not.toHaveBeenCalled()
  })

  test('starts a turn when the agent is no longer waiting', () => {
    const plan = planAwaitingReview()

    flow.submit(plan.id, 'use a nullable timestamp')

    expect(manager.respondToApproval).not.toHaveBeenCalled()
    expect(manager.enqueue).toHaveBeenCalledWith(
      's1',
      expect.stringContaining('use a nullable timestamp'),
      { planMode: true },
    )
  })

  test('the turn it starts carries the plan, since the thread may be long gone', () => {
    const plan = planAwaitingReview()

    flow.submit(plan.id, 'x')

    expect(manager.enqueue.mock.calls[0]?.[1]).toContain(BODY)
  })

  test('ignores an approval the agent is blocked on for something else', () => {
    const plan = planAwaitingReview()
    pending = [{ ...planApproval(), toolName: 'Bash', command: 'rm -rf /' }]

    flow.submit(plan.id, 'x')

    // Answering a shell command with plan notes would run it.
    expect(manager.respondToApproval).not.toHaveBeenCalled()
    expect(manager.enqueue).toHaveBeenCalled()
  })

  test('leaves it waiting on the agent', () => {
    const plan = planAwaitingReview()

    expect(flow.submit(plan.id, 'x').status).toBe('revising')
  })

  test('refuses an empty note', () => {
    const plan = planAwaitingReview()

    expect(() => flow.submit(plan.id, '   ')).toThrow('a comment cannot be empty')
    expect(manager.enqueue).not.toHaveBeenCalled()
  })

  test('refuses a plan that does not exist', () => {
    expect(() => flow.submit('nope', 'x')).toThrow('unknown plan "nope"')
  })

  test('files the passage the note was written about', () => {
    const plan = planAwaitingReview()

    flow.submit(plan.id, 'make this nullable', 'Archiving keeps the row.')

    expect(plans.comments(plan.id)).toContainEqual(
      expect.objectContaining({ text: 'make this nullable', quote: 'Archiving keeps the row.' }),
    )
  })

  test('tells the agent which passage, not just what', () => {
    const plan = planAwaitingReview()
    pending = [planApproval()]

    flow.submit(plan.id, 'make this nullable', 'Archiving keeps the row.')

    expect(manager.respondToApproval).toHaveBeenCalledWith('s1', 'a1', {
      approved: false,
      reason: expect.stringContaining('Archiving keeps the row.'),
    })
  })

  test('a passage of only whitespace is no passage at all', () => {
    const plan = planAwaitingReview()

    flow.submit(plan.id, 'too vague', '   ')

    // Otherwise the agent is handed an empty quotation to reason about.
    expect(plans.comments(plan.id)[0]?.quote).toBeUndefined()
  })
})

describe('approving a plan', () => {
  test('records the branch the work will land on', () => {
    const plan = planAwaitingReview()

    const approved = flow.approve(plan.id)

    expect(approved).toMatchObject({ status: 'building', branch: branchFor(plan) })
  })

  test('sends the agent to a worktree, out of plan mode', () => {
    const plan = planAwaitingReview()

    flow.approve(plan.id)

    const [sessionId, prompt, options] = manager.enqueue.mock.calls[0] ?? []
    expect(sessionId).toBe('s1')
    expect(prompt).toContain(worktreeFor(plan))
    // Plan mode refuses every edit for the turn; a build cannot run inside one.
    expect((options as { planMode?: boolean } | undefined)?.planMode).toBeUndefined()
  })

  test('lets the planning turn finish before the build starts', () => {
    const plan = planAwaitingReview()
    pending = [planApproval()]

    flow.approve(plan.id)

    // The blocked call has to be answered or the agent waits forever, and the
    // answer cannot be "go ahead" — this turn cannot edit anything.
    expect(manager.respondToApproval).toHaveBeenCalledWith('s1', 'a1', {
      approved: false,
      reason: expect.stringContaining('approved'),
    })
    expect(manager.enqueue).toHaveBeenCalled()
  })

  test('carries a note left with the approval', () => {
    const plan = planAwaitingReview()
    plans.comment(plan.id, { author: 'You', tone: 'you', text: 'keep the tasks' })

    flow.approve(plan.id)

    expect(manager.enqueue.mock.calls[0]?.[1]).toContain('keep the tasks')
  })

  test('refuses a plan that does not exist', () => {
    expect(() => flow.approve('nope')).toThrow('unknown plan "nope"')
  })

  test('refuses when the agent does not work in a git repository', () => {
    const plan = planAwaitingReview()
    cwd = join(home, 'not-a-repo')

    // Found the hard way: the default agent cwd is ~/roster/workspace, which
    // is not a repository. The agent was sent to make a worktree there, could
    // not, and the plan had nowhere to go.
    expect(() => flow.approve(plan.id)).toThrow(/not a git repository/)
    expect(manager.enqueue).not.toHaveBeenCalled()
    expect(plans.findById(plan.id)?.status).toBe('draft')
  })

  test('says which directory it means, so it can be changed', () => {
    const plan = planAwaitingReview()
    cwd = join(home, 'not-a-repo')

    expect(() => flow.approve(plan.id)).toThrow(new RegExp(join(home, 'not-a-repo')))
  })

  test('refuses when the agent has no working directory at all', () => {
    const plan = planAwaitingReview()
    cwd = null

    expect(() => flow.approve(plan.id)).toThrow(/not a git repository/)
  })

  test('refuses one that is already being built', () => {
    const plan = planAwaitingReview()
    flow.approve(plan.id)
    manager.enqueue.mockClear()

    // Two builds would be two branches and two pull requests for one plan.
    expect(() => flow.approve(plan.id)).toThrow('already been approved')
    expect(manager.enqueue).not.toHaveBeenCalled()
  })
})
