import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent, Approval, ToolMessage } from '@shared/types'
import type { RunnerEvent } from '@main/runners/types'

const runnerStub = {
  id: 'claude',
  detect: vi.fn(),
  models: vi.fn().mockResolvedValue([]),
  run: vi.fn(),
  respondToApproval: vi.fn(),
  onApprovalNeeded: undefined as ((event: Extract<RunnerEvent, { kind: 'approval' }>) => void) | undefined,
}

vi.mock('@main/runners/registry', () => ({
  getRunner: () => runnerStub,
  registerCustomRunners: vi.fn(),
  warmUpRunners: vi.fn(),
  allRunners: () => [runnerStub],
  isBuiltinRunner: () => true,
}))

vi.mock('@main/runners/handoffTool', () => ({
  createRosterMcpServer: vi.fn().mockResolvedValue({ fake: 'roster' }),
}))

const { openDatabase } = await import('@main/db')
const { SessionStore } = await import('@main/store/sessions')
const { UsageStore } = await import('@main/store/usage')
const { PlanStore } = await import('@main/store/plans')
const { ClaudeRunner } = await import('@main/runners/claude')
const { SessionManager } = await import('@main/sessions/manager')

const BODY = '# Archive projects\n\nArchiving keeps the row.\n'
const NEXT = '# Archive projects\n\nArchiving keeps the row and its tasks.\n'

const AGENTS: Agent[] = [
  {
    id: 'debugging',
    name: 'Debugging Agent',
    runner: 'claude',
    model: 'claude-opus-5',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: '',
    skills: [],
    mcpServers: [],
    hidden: false,
    status: 'idle',
  },
]

let home: string
let plans: InstanceType<typeof PlanStore>
let manager: InstanceType<typeof SessionManager>
let events: { type: string; [key: string]: unknown }[]

/** The approval an agent raises when it presents a plan. */
function approvalEvent(plan: string): Extract<RunnerEvent, { kind: 'approval' }> {
  return { kind: 'approval', id: 'a1', toolName: 'ExitPlanMode', command: '# Archive projects', plan }
}

/** The tool row the same call also streams. */
function toolEvent(plan: string): RunnerEvent {
  return {
    kind: 'tool',
    id: 't1',
    name: 'ExitPlanMode',
    args: '# Archive projects',
    input: JSON.stringify({ plan }),
  }
}

async function runTurn(...stream: RunnerEvent[]): Promise<string> {
  const session = manager.create('debugging', 'Work')
  await runTurnOn(session.id, ...stream)
  return session.id
}

/** Another turn on a session that already has one behind it. */
async function runTurnOn(sessionId: string, ...stream: RunnerEvent[]): Promise<void> {
  runnerStub.run.mockImplementation(async function* () {
    for (const event of stream) {
      if (event.kind === 'approval') runnerStub.onApprovalNeeded?.(event)
      else yield event
    }
    yield { kind: 'done', runnerSessionId: 'r1' } as RunnerEvent
  })

  await manager.send(sessionId, 'go', { planMode: true })
}

function toolMessages(sessionId: string): ToolMessage[] {
  return sessionsOf(sessionId).filter((m): m is ToolMessage => m.kind === 'tool')
}

let sessionsStore: InstanceType<typeof SessionStore>
function sessionsOf(sessionId: string) {
  return sessionsStore.messages(sessionId)
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-plancapture-'))
  process.env['ROSTER_HOME'] = home

  const db = openDatabase(':memory:')
  sessionsStore = new SessionStore(db)
  plans = new PlanStore(db)
  events = []

  Object.setPrototypeOf(runnerStub, ClaudeRunner.prototype)

  manager = new SessionManager(
    { findAll: () => AGENTS, findById: (id: string) => AGENTS.find((a) => a.id === id) ?? null } as never,
    sessionsStore,
    { findAll: () => [] } as never,
    { findAll: () => [] } as never,
    new UsageStore(db),
    undefined,
    plans,
  )
  manager.subscribe((event) => events.push(event as never))
  runnerStub.run.mockReset()
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

describe('a plan reaching Roster', () => {
  test('is captured when the agent asks to leave plan mode', async () => {
    const sessionId = await runTurn(approvalEvent(BODY))

    const [plan] = plans.listBySession(sessionId)
    expect(plan).toMatchObject({ title: 'Archive projects', version: 1, status: 'draft' })
    expect(plans.body(plan!.id)).toBe(BODY)
  })

  test('puts its id on the approval, so the banner can link to it', async () => {
    const sessionId = await runTurn(approvalEvent(BODY))

    const raised = events.find((e) => e.type === 'approval') as unknown as { approval: Approval }
    expect(raised.approval.planId).toBe(plans.listBySession(sessionId)[0]?.id)
  })

  test('is captured from the tool row too, so a reload can still reach it', async () => {
    const sessionId = await runTurn(toolEvent(BODY))

    expect(plans.listBySession(sessionId)).toHaveLength(1)
    expect(toolMessages(sessionId)[0]?.planId).toBe(plans.listBySession(sessionId)[0]?.id)
  })

  test('arriving down both paths is still one plan', async () => {
    // The approval callback and the tool stream carry the same plan, in no
    // guaranteed order. Two arrivals must not read as a revision.
    const sessionId = await runTurn(approvalEvent(BODY), toolEvent(BODY))

    expect(plans.listBySession(sessionId)).toHaveLength(1)
    expect(plans.listBySession(sessionId)[0]?.version).toBe(1)
  })

  test('the tool row links to the plan even when the approval got there first', async () => {
    const sessionId = await runTurn(approvalEvent(BODY), toolEvent(BODY))

    expect(toolMessages(sessionId)[0]?.planId).toBe(plans.listBySession(sessionId)[0]?.id)
  })

  test('a second plan in the same session is the next version', async () => {
    const sessionId = await runTurn(approvalEvent(BODY))
    await runTurnOn(sessionId, approvalEvent(NEXT))

    // A revision is the same document moving on, not a second one.
    expect(plans.listBySession(sessionId)).toHaveLength(1)
    expect(plans.listBySession(sessionId)[0]?.version).toBe(2)
  })

  test('leaves other tools alone', async () => {
    const sessionId = await runTurn({
      kind: 'tool',
      id: 't2',
      name: 'Read',
      args: 'src/App.tsx',
    } as RunnerEvent)

    expect(plans.listBySession(sessionId)).toEqual([])
    expect(toolMessages(sessionId)[0]?.planId).toBeUndefined()
  })

  test('survives a tool row whose input is not a plan at all', async () => {
    const sessionId = await runTurn({
      kind: 'tool',
      id: 't3',
      name: 'ExitPlanMode',
      args: 'x',
      input: 'not json',
    } as RunnerEvent)

    // Malformed input from a CLI must not take the turn down.
    expect(plans.listBySession(sessionId)).toEqual([])
  })
})

describe('a manager built without a plan store', () => {
  test('runs the same turn and captures nothing', async () => {
    const db = openDatabase(':memory:')
    const bare = new SessionManager(
      { findAll: () => AGENTS, findById: (id: string) => AGENTS.find((a) => a.id === id) ?? null } as never,
      new SessionStore(db),
      { findAll: () => [] } as never,
      { findAll: () => [] } as never,
      new UsageStore(db),
    )

    runnerStub.run.mockImplementation(async function* () {
      runnerStub.onApprovalNeeded?.(approvalEvent(BODY))
      yield { kind: 'done', runnerSessionId: 'r1' } as RunnerEvent
    })

    const session = bare.create('debugging', 'Work')
    await expect(bare.send(session.id, 'go', { planMode: true })).resolves.toBeUndefined()
    expect(bare.pendingApprovals(session.id)[0]?.planId).toBeUndefined()
  })
})

describe('a build that produced no pull request', () => {
  async function buildingPlan(): Promise<{ sessionId: string; planId: string }> {
    const sessionId = await runTurn(approvalEvent(BODY))
    const planId = plans.listBySession(sessionId)[0]!.id
    plans.setStatus(planId, 'building', { branch: 'roster/plan-x' })
    return { sessionId, planId }
  }

  test('comes back to you rather than saying "building" for ever', async () => {
    const { sessionId, planId } = await buildingPlan()

    await runTurnOn(sessionId)

    // Found the hard way: the agent could not make a worktree, said so, and
    // the plan sat in "building" with no way to answer it.
    expect(plans.findById(planId)?.status).toBe('draft')
  })

  test('says in the thread why it came back', async () => {
    const { sessionId, planId } = await buildingPlan()

    await runTurnOn(sessionId)

    expect(plans.comments(planId)).toContainEqual(
      expect.objectContaining({
        tone: 'agent',
        text: 'The build ended without opening a pull request.',
      }),
    )
  })

  test('keeps the branch, so approving again does not rename the work', async () => {
    const { sessionId, planId } = await buildingPlan()

    await runTurnOn(sessionId)

    expect(plans.findById(planId)?.branch).toBe('roster/plan-x')
  })

  test('a build that did open one is left alone', async () => {
    const { sessionId, planId } = await buildingPlan()
    plans.recordPullRequest(planId, { url: 'https://github.com/o/r/pull/31' })

    await runTurnOn(sessionId)

    expect(plans.findById(planId)?.status).toBe('in_review')
  })

  test('waits for the build turn it is still queued behind', async () => {
    const { sessionId, planId } = await buildingPlan()

    // Approving queues the build behind the planning turn. Settling when that
    // turn ends would cancel the build before it ever ran.
    let queued = false
    runnerStub.run.mockImplementation(async function* () {
      // Once: the queued turn runs through this same stub, and enqueuing
      // again from it would never stop.
      if (!queued) {
        queued = true
        manager.enqueue(sessionId, 'build it')
      }
      yield { kind: 'done', runnerSessionId: 'r1' } as RunnerEvent
    })
    await manager.send(sessionId, 'go')

    expect(plans.findById(planId)?.status).toBe('building')
  })

  test('leaves a plan nobody approved alone', async () => {
    const sessionId = await runTurn(approvalEvent(BODY))
    const planId = plans.listBySession(sessionId)[0]!.id

    await runTurnOn(sessionId)

    expect(plans.findById(planId)?.status).toBe('draft')
    expect(plans.comments(planId)).toEqual([])
  })
})
