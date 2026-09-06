/**
 * How far the plan path reaches, per runner.
 *
 * A plan has two halves and they are wired differently. Proposing one is a
 * runner event the manager recognises; recording the pull request it was
 * built into is one of Roster's own MCP tools. Neither half is reachable the
 * same way from all three runners, and this file pins down exactly where each
 * one stops so the answer cannot quietly change.
 *
 * The Claude and Codex halves are the working ones. The custom-runner cases
 * are deliberately assertions about an absence: a custom CLI is handed no
 * MCP servers at all, so enabling "plans" on such an agent does nothing.
 * Written down here rather than left as folklore.
 */
import { connect } from 'node:net'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent, CustomRunnerSpec } from '@shared/types'
import { PLANS_SERVER, ROSTER_SERVER } from '@shared/mcp'
import { EXIT_PLAN_MODE } from '@shared/plans'
import { normalizeCodexMessage } from '@main/runners/normalizeCodex'
import type { McpLaunchSpec, RunnerEvent, StartOptions } from '@main/runners/types'

const runnerStub = {
  id: 'claude',
  detect: vi.fn(),
  models: vi.fn().mockResolvedValue([]),
  run: vi.fn(),
  respondToApproval: vi.fn(),
  onApprovalNeeded: undefined as
    | ((event: Extract<RunnerEvent, { kind: 'approval' }>) => void)
    | undefined,
}

vi.mock('@main/runners/registry', () => ({
  getRunner: () => runnerStub,
  registerCustomRunners: vi.fn(),
  warmUpRunners: vi.fn(),
  allRunners: () => [runnerStub],
  isBuiltinRunner: () => true,
}))

/** The handoff server needs the SDK runtime; the plans server is left real. */
vi.mock('@main/runners/handoffTool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@main/runners/handoffTool')>()),
  createRosterMcpServer: vi.fn().mockResolvedValue({ fake: 'roster' }),
}))

const { openDatabase } = await import('@main/db')
const { SessionStore } = await import('@main/store/sessions')
const { UsageStore } = await import('@main/store/usage')
const { PlanStore } = await import('@main/store/plans')
const { ClaudeRunner } = await import('@main/runners/claude')
const { CodexRunner } = await import('@main/runners/codex')
const { CustomRunner } = await import('@main/runners/custom')
const { SessionManager } = await import('@main/sessions/manager')
const { builtinToolDefinitions } = await import('@main/runners/toolDefinitions')

const BODY = '# Archive projects\n\nArchiving keeps the row.\n'
const PR = 'https://github.com/owner/repo/pull/7'

const CUSTOM: CustomRunnerSpec = { command: 'mytool', args: ['--json', '{prompt}'] }

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'planner',
    name: 'Planning Agent',
    runner: 'claude',
    model: 'claude-opus-5',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: '',
    skills: [],
    mcpServers: [PLANS_SERVER],
    hidden: false,
    status: 'idle',
    ...overrides,
  }
}

let home: string
let agents: Agent[]
let plans: InstanceType<typeof PlanStore>
let manager: InstanceType<typeof SessionManager>
let started: StartOptions | null

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-planreach-'))
  process.env['ROSTER_HOME'] = home
  agents = [agent()]
  started = null

  const db = openDatabase(':memory:')
  plans = new PlanStore(db)
  manager = new SessionManager(
    {
      findAll: () => agents,
      findById: (id: string) => agents.find((entry) => entry.id === id) ?? null,
    } as never,
    new SessionStore(db),
    { findAll: () => [] } as never,
    { findAll: () => [] } as never,
    new UsageStore(db),
    undefined,
    plans,
  )

  runnerStub.run.mockReset()
  runnerStub.onApprovalNeeded = undefined
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

/**
 * Runs one turn, capturing the options the runner was started with.
 *
 * `during` runs from inside the turn, which is the only time the bridge a
 * Codex agent is given actually exists.
 */
async function run(
  prototype: object,
  during: (options: StartOptions) => Promise<void> = async () => {},
  ...stream: RunnerEvent[]
): Promise<string> {
  Object.setPrototypeOf(runnerStub, prototype)
  runnerStub.run.mockImplementation((_prompt: string, options: StartOptions) => {
    started = options
    return (async function* () {
      await during(options)
      for (const event of stream) {
        if (event.kind === 'approval') runnerStub.onApprovalNeeded?.(event)
        else yield event
      }
      yield { kind: 'done' as const, runnerSessionId: 'r1' }
    })()
  })

  const session = manager.create(agents[0]!.id, 'Work')
  await manager.send(session.id, 'go', { planMode: true })
  return session.id
}

/** Speaks the bridge's own protocol, as the stdio child would. */
function overBridge(spec: McpLaunchSpec, request: Record<string, unknown>): Promise<
  Record<string, unknown>
> {
  return new Promise((resolve, reject) => {
    const socket = connect(spec.env['ROSTER_MCP_SOCKET'] ?? '')
    let buffer = ''
    socket.on('error', reject)
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      if (!buffer.includes('\n')) return
      socket.destroy()
      resolve(JSON.parse(buffer.slice(0, buffer.indexOf('\n'))) as Record<string, unknown>)
    })
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ id: 1, token: spec.env['ROSTER_MCP_TOKEN'], ...request })}\n`),
    )
  })
}

/**
 * The argv a real CodexRunner builds, with plan mode on or off.
 *
 * A stand-in CLI that echoes its own arguments back as agent messages, so
 * what Codex would have been run with is read off the event stream.
 */
async function codexArgv(planMode: boolean): Promise<string[]> {
  const cli = join(home, 'argv-cli.js')
  await writeFile(
    cli,
    "#!/usr/bin/env node\nfor (const text of process.argv.slice(2)) console.log(JSON.stringify({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text } }))\n",
    'utf8',
  )
  await chmod(cli, 0o755)
  await mkdir(join(home, '.git'), { recursive: true })

  const runner = new CodexRunner()
  ;(runner as unknown as { binary: string }).binary = cli

  const argv: string[] = []
  const options: StartOptions = {
    cwd: home,
    model: 'gpt-5.5',
    systemPrompt: '',
    skillPaths: [],
    mcpServers: {},
    signal: new AbortController().signal,
    ...(planMode ? { planMode: true } : {}),
  }
  for await (const event of runner.run('go', options)) {
    if (event.kind === 'text') argv.push(event.delta)
  }
  return argv
}

/** The tool row an ExitPlanMode call streams, whichever CLI produced it. */
function exitPlanModeTool(body: string): RunnerEvent {
  return {
    kind: 'tool',
    id: 't1',
    name: EXIT_PLAN_MODE,
    args: '# Archive projects',
    input: JSON.stringify({ plan: body }),
  }
}

describe('reaching the plans server, per runner', () => {
  test('a Claude agent is handed it in process', async () => {
    await run(ClaudeRunner.prototype)

    expect(started?.inProcessMcpServers?.[PLANS_SERVER]).toBeDefined()
    // In process, so there is no command to launch.
    expect(started?.mcpServers[PLANS_SERVER]).toBeUndefined()
  })

  test('a Codex agent reaches the same tool over the bridge', async () => {
    let names: string[] = []
    await run(CodexRunner.prototype, async (options) => {
      const spec = options.mcpServers[ROSTER_SERVER]
      if (!spec) return
      const reply = await overBridge(spec, { op: 'list' })
      names = (reply['tools'] as { name: string }[]).map((tool) => tool.name)
    })

    expect(names).toContain('record_pull_request')
  })

  test('and a Codex agent’s call really lands on the plan', async () => {
    const sessionId = manager.create('planner', 'Work').id
    const plan = plans.capture({ sessionId, agentId: 'planner', body: BODY })

    await run(CodexRunner.prototype, async (options) => {
      const spec = options.mcpServers[ROSTER_SERVER]
      if (!spec) return
      await overBridge(spec, {
        op: 'call',
        name: 'record_pull_request',
        args: { plan_id: plan.id, url: PR, branch: 'roster/plan-x' },
      })
    })

    // The whole point of the bridge: the handler ran in this process, on
    // this process's store, not in the child.
    expect(plans.findById(plan.id)).toMatchObject({
      prUrl: PR,
      branch: 'roster/plan-x',
      status: 'in_review',
    })
  })

  test('a custom-runner agent is given it nowhere, even having enabled it', async () => {
    agents = [agent({ runner: 'mytool', custom: CUSTOM })]

    await run(new CustomRunner('mytool', CUSTOM))

    // Not in process — a custom CLI is a separate process. Not over the
    // bridge either — the manager starts one only for Codex, and CustomRunner
    // would have nowhere to put it: `run` never reads `options.mcpServers`.
    expect(started?.inProcessMcpServers).toBeUndefined()
    expect(started?.mcpServers[ROSTER_SERVER]).toBeUndefined()
    expect(started?.mcpServers[PLANS_SERVER]).toBeUndefined()
  })
})

describe('proposing a plan, per runner', () => {
  test('is captured from the tool row whichever runner streamed it', async () => {
    agents = [agent({ runner: 'mytool', custom: CUSTOM })]

    const sessionId = await run(
      new CustomRunner('mytool', CUSTOM),
      async () => {},
      exitPlanModeTool(BODY),
    )

    // The manager gates capture on the tool's name, not on the runner, so a
    // custom CLI speaking the Claude dialect gets a plan like Claude does.
    expect(plans.listBySession(sessionId)).toHaveLength(1)
    expect(plans.body(plans.listBySession(sessionId)[0]!.id)).toBe(BODY)
  })

  test('and plan mode changes nothing about what Codex is asked to do', async () => {
    // `codex exec` has no plan mode, and CodexRunner never reads the option.
    // Byte-identical argv is the plainest way to say so: the flag Roster sets
    // for Claude reaches Codex and is dropped on the floor.
    const plain = await codexArgv(false)
    const planning = await codexArgv(true)

    // The stand-in CLI really ran, so an empty argv cannot pass this.
    expect(plain).toContain('exec')
    expect(planning).toEqual(plain)
  })

  test('but nothing in the Codex stream can carry one', () => {
    // Every item type Codex emits, put through the normalizer. If one of
    // these ever yielded an approval or an ExitPlanMode tool, a Codex agent
    // could propose a plan — and today none of them can.
    const stream = [
      { type: 'thread.started', thread_id: 'th1' },
      { type: 'turn.started' },
      { type: 'item.started', item: { id: 'i1', type: 'agent_message' } },
      { type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: 'here is my plan' } },
      { type: 'item.started', item: { id: 'i2', type: 'command_execution', command: 'ls' } },
      { type: 'item.completed', item: { id: 'i2', type: 'command_execution', exit_code: 0 } },
      { type: 'item.started', item: { id: 'i3', type: 'file_change', path: 'a.ts' } },
      { type: 'item.completed', item: { id: 'i3', type: 'file_change', path: 'a.ts' } },
      { type: 'turn.completed', usage: {} },
    ]

    const events = stream.flatMap((line) => normalizeCodexMessage(line))

    expect(events.some((event) => event.kind === 'approval')).toBe(false)
    expect(
      events.some((event) => event.kind === 'tool' && event.name === EXIT_PLAN_MODE),
    ).toBe(false)
  })
})

describe('the flat namespace the bridge serves', () => {
  test('has no two tools under one name', () => {
    // The bridge keys its tools by bare name, dropping the server they were
    // grouped under. Two servers registering the same name would silently
    // lose one of them, and record_pull_request is a name of exactly one word.
    const definitions = builtinToolDefinitions(
      {
        roster: {
          listAgents: () => [],
          openSession: () => ({ sessionId: 's', label: 'l', started: true }),
          closeSession: () => true,
        },
        plans: { recordPullRequest: () => ({}) as never },
        tasks: {} as never,
        memory: {} as never,
      } as never,
      'planner',
    )

    const names = definitions.map((definition) => definition.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
