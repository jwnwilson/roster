import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { PlanStore } from '@main/store/plans'
import { buildPlanTools, PLAN_TOOL_NAMES, type PlanTools } from '@main/runners/planTools'

/**
 * The tool handlers themselves, against a real plan store — the same shape
 * createTaskTool.test.ts uses for the board.
 */

interface ToolResult {
  isError?: boolean
  content: { text: string }[]
}

let home: string
let db: Db
let plans: PlanStore

/** A stand-in for the SDK factory: records each tool by the name it is given. */
function handlers(): Map<string, (args: never) => Promise<ToolResult>> {
  const built = new Map<string, (args: never) => Promise<ToolResult>>()
  const factory = ((name: string, _description: string, _schema: unknown, handler: never) => {
    built.set(name, handler)
    return { name }
  }) as never

  const tools: PlanTools = {
    propose: (body) => plans.capture({ sessionId: 's1', agentId: 'debugging', body }),
    // Reads the real store, so a test that moves the plan on moves what the
    // handler sees with it.
    currentStatus: () => plans.listBySession('s1').at(-1)?.status ?? null,
    recordPullRequest: (planId, input) => plans.recordPullRequest(planId, input),
  }

  buildPlanTools(tools, factory)
  return built
}

function recordPullRequest(): (args: never) => Promise<ToolResult> {
  const handler = handlers().get('record_pull_request')
  if (!handler) throw new Error('record_pull_request was never built')
  return handler
}

function aPlan() {
  db.prepare(
    'INSERT INTO sessions (id, agent_id, title, origin, status, created_at)' +
      " VALUES ('s1', 'debugging', 'Work', 'you', 'idle', 0)",
  ).run()
  return plans.capture({ sessionId: 's1', agentId: 'debugging', body: '# Do it\n' })
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-plantools-'))
  process.env['ROSTER_HOME'] = home
  db = openDatabase(':memory:')
  plans = new PlanStore(db)
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  db.close()
  await rm(home, { recursive: true, force: true })
})

describe('the plan tools an agent is given', () => {
  test('are named the way the runner allowlist expects', () => {
    // A tool missing from the list does not fail loudly — it blocks on the
    // approval gate forever.
    expect(PLAN_TOOL_NAMES).toEqual([
      'mcp__plans__propose_plan',
      'mcp__plans__record_pull_request',
    ])
    expect([...handlers().keys()]).toEqual(['propose_plan', 'record_pull_request'])
  })
})

describe('an agent presenting a plan', () => {
  function proposePlan(): (args: never) => Promise<ToolResult> {
    const handler = handlers().get('propose_plan')
    if (!handler) throw new Error('propose_plan was never built')
    return handler
  }

  test('captures the plan and names it back so the agent knows it landed', async () => {
    // Arrange
    aPlan()

    // Act
    const result = await proposePlan()({ plan: '# Add a cache\n\nThe details.' } as never)

    // Assert
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('Add a cache')
    expect(plans.listBySession('s1').map((plan) => plan.title)).toContain('Add a cache')
  })

  test('tells the agent to stop rather than carry on into the work', async () => {
    aPlan()

    const result = await proposePlan()({ plan: '# Do it\n\nHow.' } as never)

    expect(result.content[0]?.text).toMatch(/stop/i)
  })

  test('refuses an empty plan with something the agent can act on', async () => {
    aPlan()

    const result = await proposePlan()({ plan: '   ' } as never)

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('plan')
  })

  test('will not turn a plan being built back into a draft', async () => {
    // `capture` rewrites the newest plan in place and resets it to 'draft'
    // while keeping the branch and pull request it had picked up. A stray
    // propose on a later turn would leave a draft that still shows a pull
    // request and offers "Approve & build" again, and settleBuild cannot
    // catch it because it only matches a plan that still reads 'building'.
    // Arrange
    const plan = aPlan()
    plans.setStatus(plan.id, 'building', { branch: 'roster/plan-abc' })

    // Act
    const result = await proposePlan()({ plan: '# Something else\n\nWhy.' } as never)

    // Assert
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toMatch(/already being built/i)
    expect(plans.findById(plan.id)).toMatchObject({ status: 'building', version: 1 })
  })

  test('will not reopen a plan whose pull request is already up for review', async () => {
    const plan = aPlan()
    plans.recordPullRequest(plan.id, { url: 'https://github.com/o/r/pull/31' })

    const result = await proposePlan()({ plan: '# Something else\n\nWhy.' } as never)

    expect(result.isError).toBe(true)
    expect(plans.findById(plan.id)).toMatchObject({
      status: 'in_review',
      prUrl: 'https://github.com/o/r/pull/31',
      version: 1,
    })
  })

  test('still takes a revision while the plan is a draft', async () => {
    const plan = aPlan()

    const result = await proposePlan()({ plan: '# Revised\n\nBetter.' } as never)

    expect(result.isError).toBeUndefined()
    expect(plans.findById(plan.id)).toMatchObject({ status: 'draft', version: 2 })
  })

  test('still takes a revision while the plan is out for revision', async () => {
    // The whole point of the revise flow: you sent notes back, and the
    // rewritten plan is what returns.
    const plan = aPlan()
    plans.setStatus(plan.id, 'revising')

    const result = await proposePlan()({ plan: '# Revised\n\nBetter.' } as never)

    expect(result.isError).toBeUndefined()
    expect(plans.findById(plan.id)).toMatchObject({ status: 'draft', version: 2 })
  })
})

describe('an agent reporting its pull request', () => {
  test('puts the plan up for review with a link to it', async () => {
    const plan = aPlan()

    const result = await recordPullRequest()({
      plan_id: plan.id,
      url: 'https://github.com/o/r/pull/31',
    } as never)

    expect(result.isError).toBeUndefined()
    expect(plans.findById(plan.id)).toMatchObject({
      status: 'in_review',
      prUrl: 'https://github.com/o/r/pull/31',
    })
  })

  test('can say which branch it actually came from', async () => {
    const plan = aPlan()

    await recordPullRequest()({
      plan_id: plan.id,
      url: 'https://github.com/o/r/pull/31',
      branch: 'somewhere/else',
    } as never)

    expect(plans.findById(plan.id)?.branch).toBe('somewhere/else')
  })

  test('says so rather than throwing when the plan is not one it knows', async () => {
    const result = await recordPullRequest()({
      plan_id: 'nope',
      url: 'https://github.com/o/r/pull/31',
    } as never)

    // An error the agent can read and act on beats one that kills the turn.
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('nope')
  })

  test('refuses a url that is not one', async () => {
    const plan = aPlan()

    const result = await recordPullRequest()({ plan_id: plan.id, url: 'not a url' } as never)

    expect(result.isError).toBe(true)
    expect(plans.findById(plan.id)?.status).toBe('draft')
  })
})
