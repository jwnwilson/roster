import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent } from '@shared/types'
import { MEMORY_SERVER, PLANS_SERVER, ROSTER_SERVER, TASKS_SERVER } from '@shared/mcp'
import type { McpLaunchSpec, StartOptions } from '@main/runners/types'
// Type only, so naming it here cannot load the module before the mocks below.
import type { McpBridge as Bridge } from '@main/runners/mcpBridge'

const runnerStub = {
  id: 'codex',
  detect: vi.fn(),
  models: vi.fn().mockResolvedValue([]),
  run: vi.fn(),
  respondToApproval: vi.fn(),
}

vi.mock('@main/runners/registry', () => ({
  getRunner: () => runnerStub,
  registerCustomRunners: vi.fn(),
  warmUpRunners: vi.fn(),
  allRunners: () => [runnerStub],
  isBuiltinRunner: () => true,
}))

/** The Claude path needs the SDK runtime the tests do not have. */
vi.mock('@main/runners/handoffTool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@main/runners/handoffTool')>()),
  createRosterMcpServer: vi.fn().mockResolvedValue({ fake: 'roster' }),
}))

const { openDatabase } = await import('@main/db')
const { SessionStore } = await import('@main/store/sessions')
const { UsageStore } = await import('@main/store/usage')
const { ProjectStore } = await import('@main/store/projects')
const { TaskStore } = await import('@main/store/tasks')
const { PlanStore } = await import('@main/store/plans')
const { ProjectNotesStore } = await import('@main/store/projectNotes')
const { CodexRunner } = await import('@main/runners/codex')
const { McpBridge } = await import('@main/runners/mcpBridge')
const { ClaudeRunner } = await import('@main/runners/claude')
const { SessionManager } = await import('@main/sessions/manager')

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'codey',
    name: 'Codex Agent',
    runner: 'codex',
    model: 'gpt-5.5',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: '',
    skills: [],
    mcpServers: [],
    hidden: false,
    status: 'idle',
    ...overrides,
  }
}

let agents: Agent[]
let home: string
let manager: InstanceType<typeof SessionManager>
let started: StartOptions | null

/** The tools the bridge was serving while the turn was running. */
let served: { name: string; annotations: Record<string, unknown> }[]
let bridgeAddress: string | null

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-codexsession-'))
  process.env['ROSTER_HOME'] = home
  agents = [agent(), agent({ id: 'other', name: 'Other Agent' })]
  started = null
  served = []
  bridgeAddress = null

  Object.setPrototypeOf(runnerStub, CodexRunner.prototype)
  runnerStub.run.mockReset()
  runnerStub.run.mockImplementation((_prompt: string, options: StartOptions) => {
    started = options
    return (async function* () {
      // Read the tool list from inside the turn: the bridge only exists
      // while one is running, which is the behaviour worth pinning down.
      const spec = options.mcpServers[ROSTER_SERVER]
      if (spec) {
        bridgeAddress = spec.env['ROSTER_MCP_SOCKET'] ?? null
        served = await listOverBridge(spec)
      }
      yield { kind: 'done' as const, runnerSessionId: 'thread-1' }
    })()
  })

  const db = openDatabase(':memory:')
  manager = new SessionManager(
    {
      findAll: () => agents,
      findById: (id: string) => agents.find((entry) => entry.id === id) ?? null,
    } as never,
    new SessionStore(db),
    { findAll: () => [] } as never,
    { findAll: () => [] } as never,
    new UsageStore(db),
    { tasks: new TaskStore(db, () => null), projects: new ProjectStore(db) },
    new PlanStore(db),
    new ProjectNotesStore(),
  )
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

/** Speaks the bridge's own protocol, as the stdio child would. */
function listOverBridge(
  spec: McpLaunchSpec,
): Promise<{ name: string; annotations: Record<string, unknown> }[]> {
  return new Promise((resolve, reject) => {
    const socket = connect(spec.env['ROSTER_MCP_SOCKET'] ?? '')
    let buffer = ''
    socket.on('error', reject)
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      if (!buffer.includes('\n')) return
      socket.destroy()
      resolve(
        (JSON.parse(buffer.slice(0, buffer.indexOf('\n'))) as { tools: never[] }).tools ?? [],
      )
    })
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ id: 1, op: 'list', token: spec.env['ROSTER_MCP_TOKEN'] })}\n`),
    )
  })
}

async function run(agentId = 'codey'): Promise<void> {
  const session = manager.create(agentId, 'Work')
  await manager.send(session.id, 'go')
}

describe('a Codex agent’s MCP servers', () => {
  test('include Roster’s own, launched as a stdio server it can spawn', async () => {
    await run()

    const spec = started?.mcpServers[ROSTER_SERVER]
    expect(spec?.command).toBe(process.execPath)
    expect(spec?.args[0]).toMatch(/mcpStdio\./)
    expect(spec?.env['ELECTRON_RUN_AS_NODE']).toBe('1')
  })

  test('registers the shared roster tools, including child-session closure', async () => {
    await run()

    expect(served.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['list_agents', 'open_session', 'close_session']),
    )
  })

  test('marks only child-session closure destructive', async () => {
    await run()

    expect(served.find((tool) => tool.name === 'close_session')?.annotations).toMatchObject({
      destructiveHint: true,
      openWorldHint: false,
    })
    for (const tool of served.filter((tool) => tool.name !== 'close_session')) {
      expect(tool.annotations).toMatchObject({ destructiveHint: false, openWorldHint: false })
    }
  })
})

describe('which of Roster’s tools a Codex agent gets', () => {
  test('is decided by its own mcp_servers, exactly as it is for Claude', async () => {
    agents = [agent({ mcpServers: [TASKS_SERVER, PLANS_SERVER] }), agents[1] as Agent]

    await run()

    const names = served.map((tool) => tool.name)
    expect(names).toContain('list_tasks')
    expect(names).toContain('record_pull_request')
    // Not enabled, so not offered — there is nothing to refuse it.
    expect(names).not.toContain('remember')
  })

  test('is only the handoff tools when it has enabled nothing', async () => {
    await run()

    expect(served.map((tool) => tool.name).sort()).toEqual([
      'close_session',
      'list_agents',
      'open_session',
    ])
  })

  test('excludes the project notes when the session is filed under no project', async () => {
    agents = [agent({ mcpServers: [MEMORY_SERVER] }), agents[1] as Agent]

    await run()

    expect(served.map((tool) => tool.name)).not.toContain('recall')
  })
})

describe('the bridge’s lifetime', () => {
  test('ends with the turn, so no turn leaves a socket behind', async () => {
    await run()

    expect(bridgeAddress).not.toBeNull()
    expect(existsSync(bridgeAddress as string)).toBe(false)
  })

  test('ends even when the turn failed', async () => {
    runnerStub.run.mockImplementation((_prompt: string, options: StartOptions) => {
      bridgeAddress = options.mcpServers[ROSTER_SERVER]?.env['ROSTER_MCP_SOCKET'] ?? null
      return (async function* () {
        yield { kind: 'done' as const, runnerSessionId: '' }
        throw new Error('the CLI fell over')
      })()
    })

    await run()

    expect(bridgeAddress).not.toBeNull()
    expect(existsSync(bridgeAddress as string)).toBe(false)
  })
})

describe('a Claude agent', () => {
  test('is still given the servers in process, not a socket', async () => {
    Object.setPrototypeOf(runnerStub, ClaudeRunner.prototype)
    agents = [agent({ runner: 'claude' }), agents[1] as Agent]

    await run()

    expect(started?.mcpServers[ROSTER_SERVER]).toBeUndefined()
    expect(started?.inProcessMcpServers?.[ROSTER_SERVER]).toBeDefined()
  })
})

describe('a bridge that cannot be closed', () => {
  /**
   * A close that fails really does leave its directory behind — that is the
   * situation being simulated — so the test takes it away itself rather than
   * leaving one in the temp directory per run.
   */
  function refuseToClose(): { restore: () => Promise<void> } {
    const leaked: string[] = []
    const spy = vi
      .spyOn(McpBridge.prototype, 'close')
      .mockImplementationOnce(async function (this: Bridge) {
        leaked.push(this.dir)
        throw new Error('permission denied')
      })

    return {
      restore: async () => {
        spy.mockRestore()
        for (const dir of leaked) await rm(dir, { recursive: true, force: true })
      },
    }
  }

  test('does not leave the session reading as streaming for good', async () => {
    // Tearing the bridge down is the first thing the turn's `finally` does,
    // so a rejection there would skip every cleanup after it — the same
    // wedge the `try` was widened to prevent in the first place.
    const failing = refuseToClose()

    const session = manager.create('codey', 'Work')
    await manager.send(session.id, 'go')
    await failing.restore()

    expect(manager.isStreaming(session.id)).toBe(false)
  })

  test('still lets the turn finish and be recorded', async () => {
    const failing = refuseToClose()
    const written: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk))
      return true
    }) as typeof process.stderr.write

    const session = manager.create('codey', 'Work')
    try {
      await manager.send(session.id, 'go')
    } finally {
      process.stderr.write = original
      await failing.restore()
    }

    // Reported rather than swallowed, and the turn reached its end state.
    expect(written.join('')).toContain('could not close the bridge')
    expect(manager.isStreaming(session.id)).toBe(false)
  })
})
