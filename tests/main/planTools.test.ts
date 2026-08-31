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
    expect(PLAN_TOOL_NAMES).toEqual(['mcp__plans__record_pull_request'])
    expect([...handlers().keys()]).toEqual(['record_pull_request'])
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
