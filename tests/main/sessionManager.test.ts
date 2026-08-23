import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent, McpServer, Skill } from '@shared/types'
import type { RunnerEvent } from '@main/runners/types'

/** The registry is stubbed so a turn can be driven without a real CLI. */
const runnerStub = {
  id: 'claude',
  detect: vi.fn(),
  models: vi.fn().mockResolvedValue([]),
  run: vi.fn(),
  respondToApproval: vi.fn(),
}

vi.mock('@main/runners/registry', () => ({
  getRunner: (id: string) => (id === 'missing' ? null : runnerStub),
  registerCustomRunners: vi.fn(),
  warmUpRunners: vi.fn(),
  allRunners: () => [runnerStub],
  isBuiltinRunner: () => true,
}))

// The roster MCP server needs the SDK runtime; the manager only passes it on.
vi.mock('@main/runners/handoffTool', () => ({
  createRosterMcpServer: vi.fn().mockResolvedValue({ fake: 'mcp' }),
}))

const { openDatabase } = await import('@main/db')
const { SessionStore } = await import('@main/store/sessions')
const { UsageStore } = await import('@main/store/usage')
const { SessionManager } = await import('@main/sessions/manager')

let home: string
let manager: InstanceType<typeof SessionManager>
let sessions: InstanceType<typeof SessionStore>
let usage: InstanceType<typeof UsageStore>
let events: unknown[]

const AGENTS: Agent[] = [
  {
    id: 'debugging',
    name: 'Debugging Agent',
    runner: 'claude',
    model: 'claude-opus-5',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: 'Reproduce before you fix.',
    skills: ['repro-harness'],
    mcpServers: ['filesystem'],
    status: 'idle',
  },
  {
    id: 'review',
    name: 'Review Agent',
    runner: 'claude',
    model: 'claude-sonnet-5',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: 'Review for correctness.',
    skills: [],
    mcpServers: [],
    status: 'idle',
  },
]

const SKILLS: Skill[] = [
  { name: 'repro-harness', path: '/skills/repro-harness', files: ['SKILL.md'], lastEditedMs: 0 },
  { name: 'unused', path: '/skills/unused', files: [], lastEditedMs: 0 },
]

const SERVERS: McpServer[] = [
  { name: 'filesystem', command: 'npx server-filesystem ~', enabledFor: ['debugging'] },
  { name: 'github', command: 'npx server-github', enabledFor: [] },
]

/** Turns a fixed event list into the async iterable a runner returns. */
function streamOf(events: RunnerEvent[]) {
  return async function* () {
    for (const event of events) yield event
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-mgr-'))
  process.env['ROSTER_HOME'] = home

  const db = openDatabase(':memory:')
  sessions = new SessionStore(db)
  usage = new UsageStore(db)
  events = []

  const agentStore = {
    findAll: () => AGENTS,
    findById: (id: string) => AGENTS.find((a) => a.id === id) ?? null,
  }
  const skillStore = { findAll: () => SKILLS }
  const mcpStore = { findAll: () => SERVERS }

  manager = new SessionManager(
    agentStore as never,
    sessions,
    skillStore as never,
    mcpStore as never,
    usage,
  )
  manager.subscribe((event) => events.push(event))
  runnerStub.run.mockReset()
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

function kinds(): string[] {
  return sessions
    .messages(sessions.listByAgent('debugging')[0]?.id ?? '')
    .map((m) => m.kind)
}

describe('SessionManager.send — a plain turn', () => {
  test('persists the user message before the runner starts', async () => {
    runnerStub.run.mockImplementation(() => {
      // By the time the runner is invoked the prompt is already stored, so a
      // crash mid-turn cannot lose it.
      const stored = sessions.messages(sessions.listByAgent('debugging')[0]!.id)
      expect(stored).toHaveLength(1)
      return streamOf([])()
    })

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'Find the leak.')
  })

  test('stores assistant prose as one message, not one per delta', async () => {
    runnerStub.run.mockImplementation(
      streamOf([
        { kind: 'text', delta: 'Reproduced ' },
        { kind: 'text', delta: 'the leak.' },
      ]),
    )

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    const text = sessions.messages(session.id).filter((m) => m.kind === 'text')
    expect(text).toHaveLength(2) // the user's, plus one coalesced assistant message
  })

  test('moves the session through running then done', async () => {
    runnerStub.run.mockImplementation(streamOf([{ kind: 'text', delta: 'hi' }]))

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    const statuses = events.filter((e): e is { type: string; status: string } =>
      (e as { type: string }).type === 'status',
    )
    expect(statuses.map((s) => s.status)).toEqual(['running', 'done'])
  })

  test('brackets the turn with streaming on and off', async () => {
    runnerStub.run.mockImplementation(streamOf([]))

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    const streaming = events.filter((e) => (e as { type: string }).type === 'streaming')
    expect(streaming.map((e) => (e as { active: boolean }).active)).toEqual([true, false])
  })

  test('refuses a second turn while one is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    runnerStub.run.mockImplementation(async function* () {
      await gate
      yield { kind: 'text', delta: 'done' } as RunnerEvent
    })

    const session = manager.create('debugging', 'x')
    const first = manager.send(session.id, 'go')

    await expect(manager.send(session.id, 'again')).rejects.toThrow(/already running/)
    release()
    await first
  })
})

describe('SessionManager.send — tools', () => {
  test('opens a tool row on the call and fills it in on the result', async () => {
    runnerStub.run.mockImplementation(
      streamOf([
        { kind: 'tool', id: 't1', name: 'Bash', args: 'pytest -k leak' },
        { kind: 'result', id: 't1', output: '1 passed', isError: false },
      ]),
    )

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    expect(kinds()).toEqual(['text', 'tool'])
    const updated = events.find((e) => (e as { type: string }).type === 'message-updated')
    expect(updated).toMatchObject({ message: { output: '1 passed', isError: false } })
  })

  test('ignores a result for a tool call it never saw', async () => {
    runnerStub.run.mockImplementation(
      streamOf([{ kind: 'result', id: 'unknown', output: 'x', isError: false }]),
    )

    const session = manager.create('debugging', 'x')
    await expect(manager.send(session.id, 'go')).resolves.toBeUndefined()
  })
})

describe('SessionManager.send — usage', () => {
  test('persists totals so they survive a reload', async () => {
    runnerStub.run.mockImplementation(
      streamOf([{ kind: 'usage', inputTokens: 100, outputTokens: 50, costUsd: 0.25 }]),
    )

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    expect(usage.forSession(session.id)).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.25,
    })
  })

  test('computes the context fraction from the agent model', async () => {
    runnerStub.run.mockImplementation(
      streamOf([{ kind: 'usage', inputTokens: 500_000, outputTokens: 0, costUsd: 0 }]),
    )

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    // claude-opus-5 is a 1M window, so half of it.
    expect(usage.forSession(session.id)?.contextUsed).toBeCloseTo(0.5)
  })

  test('never reports more than a full context window', async () => {
    runnerStub.run.mockImplementation(
      streamOf([{ kind: 'usage', inputTokens: 9_000_000, outputTokens: 0, costUsd: 0 }]),
    )

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    expect(usage.forSession(session.id)?.contextUsed).toBe(1)
  })
})

describe('SessionManager.send — session identity and failure', () => {
  test('records the runner session id for resume', async () => {
    runnerStub.run.mockImplementation(
      streamOf([{ kind: 'session', runnerSessionId: 'thread-1' }]),
    )

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    expect(sessions.findById(session.id)?.runnerSessionId).toBe('thread-1')
  })

  test('resumes from it on the next turn', async () => {
    runnerStub.run.mockImplementation(
      streamOf([{ kind: 'done', runnerSessionId: 'thread-1' }]),
    )
    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'first')

    runnerStub.run.mockImplementation(streamOf([]))
    await manager.send(session.id, 'second')

    expect(runnerStub.run.mock.calls[1]?.[1]).toMatchObject({ resumeFrom: 'thread-1' })
  })

  test('an error event puts the session in error and says why', async () => {
    runnerStub.run.mockImplementation(
      streamOf([{ kind: 'error', message: 'the model refused' }]),
    )

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    expect(sessions.findById(session.id)?.status).toBe('error')
    const last = sessions.messages(session.id).at(-1)
    expect(last).toMatchObject({ kind: 'text', text: 'the model refused' })
  })

  test('a thrown runner still ends the turn rather than hanging', async () => {
    runnerStub.run.mockImplementation(async function* () {
      throw new Error('the CLI crashed')
      // eslint-disable-next-line no-unreachable
      yield {} as RunnerEvent
    })

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    const streaming = events.filter((e) => (e as { type: string }).type === 'streaming')
    expect(streaming.at(-1)).toMatchObject({ active: false })
    expect(sessions.findById(session.id)?.status).toBe('error')
  })

  test('an unregistered runner fails the turn instead of throwing', async () => {
    const stray = sessions.create({ agentId: 'debugging', title: 'x', origin: 'you' })
    // The agent claims a runner the registry does not know.
    const agent = AGENTS[0]!
    const original = agent.runner
    ;(agent as { runner: string }).runner = 'missing'

    await manager.send(stray.id, 'go')
    ;(agent as { runner: string }).runner = original

    expect(sessions.findById(stray.id)?.status).toBe('error')
  })
})

describe('SessionManager — what the runner is given', () => {
  test('passes only the skills this agent has enabled', async () => {
    runnerStub.run.mockImplementation(streamOf([]))

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    expect(runnerStub.run.mock.calls[0]?.[1]).toMatchObject({
      skillPaths: ['/skills/repro-harness'],
    })
  })

  test('passes only MCP servers enabled for this agent', async () => {
    runnerStub.run.mockImplementation(streamOf([]))

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    const options = runnerStub.run.mock.calls[0]?.[1] as { mcpServers: Record<string, unknown> }
    expect(Object.keys(options.mcpServers)).toEqual(['filesystem'])
    expect(options.mcpServers['filesystem']).toEqual({
      command: 'npx',
      args: ['server-filesystem', '~'],
    })
  })

  test('passes the agent cwd, model, and system prompt', async () => {
    runnerStub.run.mockImplementation(streamOf([]))

    const session = manager.create('debugging', 'x')
    await manager.send(session.id, 'go')

    expect(runnerStub.run.mock.calls[0]?.[1]).toMatchObject({
      cwd: '/work/api',
      model: 'claude-opus-5',
      systemPrompt: 'Reproduce before you fix.',
    })
  })
})

describe('SessionManager.handOff', () => {
  test('opens a session on the other agent, marked as agent-opened', () => {
    const from = manager.create('debugging', 'Leak')
    const { session } = manager.handOff({
      fromAgentId: 'debugging',
      fromSessionId: from.id,
      toAgentId: 'review',
      title: 'PR #482',
      brief: 'Review the fix.',
    })

    expect(session.agentId).toBe('review')
    expect(session.origin).toBe('agent')
    expect(session.from).toBe('Debugging Agent · PR #482')
  })

  test('the receiving session opens with the brief and a way back', () => {
    const from = manager.create('debugging', 'Leak')
    const { session } = manager.handOff({
      fromAgentId: 'debugging',
      fromSessionId: from.id,
      toAgentId: 'review',
      title: 'PR #482',
      brief: 'Review the fix.',
    })

    const [spawn] = sessions.messages(session.id)
    expect(spawn).toMatchObject({
      kind: 'spawn',
      from: 'Debugging Agent',
      text: 'Review the fix.',
      to: { agentId: 'debugging', sessionId: from.id },
    })
  })

  test('the handing-off session gets a link forward', () => {
    const from = manager.create('debugging', 'Leak')
    const { session } = manager.handOff({
      fromAgentId: 'debugging',
      fromSessionId: from.id,
      toAgentId: 'review',
      title: 'PR #482',
      brief: 'Review the fix.',
    })

    const handoff = sessions.messages(from.id).find((m) => m.kind === 'handoff')
    expect(handoff).toMatchObject({
      links: [{ agentId: 'review', sessionId: session.id, label: 'Review Agent · PR #482' }],
    })
  })
})

describe('SessionManager.cancel', () => {
  test('aborts the signal the runner was given', async () => {
    let seen: AbortSignal | undefined
    runnerStub.run.mockImplementation(async function* (_p: string, options: { signal: AbortSignal }) {
      seen = options.signal
      yield { kind: 'text', delta: 'x' } as RunnerEvent
    })

    const session = manager.create('debugging', 'x')
    const turn = manager.send(session.id, 'go')
    await turn

    manager.cancel(session.id)
    expect(seen).toBeDefined()
  })
})
