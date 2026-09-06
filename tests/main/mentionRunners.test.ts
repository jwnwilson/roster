import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent } from '@shared/types'
import { ROSTER_SERVER, TASKS_SERVER } from '@shared/mcp'
import type { RunnerEvent, StartOptions } from '@main/runners/types'

/**
 * Does an `@mention` in a task comment reach the agent whichever CLI is
 * behind it?
 *
 * `tests/main/taskMentions.test.ts` drives `TaskMentions` through a spy, so it
 * proves the dispatcher's own behaviour and nothing about the runners. These
 * tests wire the real `SessionManager` underneath it instead, with one stub
 * per runner class, so the branch at `manager.ts:392` is actually taken.
 */

/** One stub per runner, keyed the way the registry keys them. */
const runners = new Map<
  string,
  { id: string; run: ReturnType<typeof vi.fn>; respondToApproval: ReturnType<typeof vi.fn> }
>()

vi.mock('@main/runners/registry', () => ({
  getRunner: (id: string) => runners.get(id) ?? null,
  registerCustomRunners: vi.fn(),
  warmUpRunners: vi.fn(),
  allRunners: () => [...runners.values()],
  isBuiltinRunner: (id: string) => id === 'claude' || id === 'codex',
}))

/** The Claude path builds real SDK servers, which these tests have no runtime for. */
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
const { ClaudeRunner } = await import('@main/runners/claude')
const { CodexRunner } = await import('@main/runners/codex')
const { CustomRunner } = await import('@main/runners/custom')
const { SessionManager } = await import('@main/sessions/manager')
const { TaskMentions } = await import('@main/sessions/mentions')

/** The three runner kinds, named as an agent.toml names them. */
const RUNNERS = [
  { runner: 'claude', prototype: () => ClaudeRunner.prototype },
  { runner: 'codex', prototype: () => CodexRunner.prototype },
  { runner: 'mine', prototype: () => CustomRunner.prototype },
] as const

function anAgent(runner: string): Agent {
  return {
    id: `on-${runner}`,
    name: `Agent on ${runner}`,
    runner,
    model: 'a-model',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: '',
    skills: [],
    mcpServers: [TASKS_SERVER],
    hidden: false,
    status: 'idle',
    ...(runner === 'mine' ? { custom: { command: 'my-cli', args: ['--json'] } } : {}),
  }
}

const ROSTER: Agent[] = RUNNERS.map((entry) => anAgent(entry.runner))

let home: string
let sessions: InstanceType<typeof SessionStore>
let tasks: InstanceType<typeof TaskStore>
let mentions: InstanceType<typeof TaskMentions>
/** The options each runner was started with, in order, keyed by runner id. */
let started: Map<string, StartOptions[]>

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-mention-runners-'))
  process.env['ROSTER_HOME'] = home
  started = new Map()

  runners.clear()
  for (const entry of RUNNERS) {
    const stub = {
      id: entry.runner,
      detect: vi.fn(),
      models: vi.fn().mockResolvedValue([]),
      run: vi.fn((_prompt: string, options: StartOptions): AsyncIterable<RunnerEvent> => {
        const seen = started.get(entry.runner) ?? []
        started.set(entry.runner, [...seen, options])
        return (async function* () {
          yield { kind: 'text' as const, delta: `answered by ${entry.runner}` }
          // A real turn ends by naming the CLI-side thread it left behind,
          // which is what a later turn would resume from.
          yield { kind: 'done' as const, runnerSessionId: `thread-${entry.runner}` }
        })()
      }),
      respondToApproval: vi.fn(),
    }
    // The manager decides how to deliver Roster's tools with `instanceof`,
    // so a stub has to be an instance of the class it stands in for.
    Object.setPrototypeOf(stub, entry.prototype())
    runners.set(entry.runner, stub)
  }

  const db = openDatabase(':memory:')
  sessions = new SessionStore(db)
  tasks = new TaskStore(db, (id) => ROSTER.find((entry) => entry.id === id)?.name ?? null)

  const manager = new SessionManager(
    {
      findAll: () => ROSTER,
      findById: (id: string) => ROSTER.find((entry) => entry.id === id) ?? null,
    } as never,
    sessions,
    { findAll: () => [] } as never,
    { findAll: () => [] } as never,
    new UsageStore(db),
    { tasks, projects: new ProjectStore(db) },
    new PlanStore(db),
    new ProjectNotesStore(),
  )

  mentions = new TaskMentions(() => ROSTER, sessions, tasks, manager)
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

function aTask(): string {
  return tasks.create({ title: 'Fix connection pool leak', description: 'It leaks on 504.' }).id
}

describe('an @mention starts a turn whichever runner the agent is on', () => {
  for (const { runner } of RUNNERS) {
    test(`a ${runner} agent gets a turn`, async () => {
      // Arrange
      const task = aTask()

      // Act
      await mentions.dispatch(task, `@on-${runner} what do you make of this?`)

      // Assert
      expect(runners.get(runner)?.run).toHaveBeenCalledTimes(1)
      expect(started.get(runner)?.[0]?.cwd).toBe('/work/api')
    })

    test(`a ${runner} agent is sent the task, not just the comment`, async () => {
      const task = aTask()

      await mentions.dispatch(task, `@on-${runner} what do you make of this?`)

      const prompt = runners.get(runner)?.run.mock.calls[0]?.[0] as string
      expect(prompt).toContain(`You have been mentioned on ${task}`)
      expect(prompt).toContain('It leaks on 504.')
    })

    test(`a ${runner} agent's answer is posted back to the thread`, async () => {
      const task = aTask()

      await mentions.dispatch(task, `@on-${runner} what do you make of this?`)

      expect(tasks.comments(task).map((entry) => entry.text)).toContain(
        `answered by ${runner}`,
      )
    })
  }
})

describe('a second mention continues the session, whichever runner it is on', () => {
  for (const { runner } of RUNNERS) {
    test(`a ${runner} agent keeps the session it already had`, async () => {
      // Arrange
      const task = aTask()
      await mentions.dispatch(task, `@on-${runner} first question`)
      const first = sessions.findByTask(task, `on-${runner}`)

      // Act
      await mentions.dispatch(task, `@on-${runner} and the follow-up?`)

      // Assert — one session, two turns on it.
      expect(sessions.findByTask(task, `on-${runner}`)?.id).toBe(first?.id)
      expect(sessions.linksForTask(task)).toHaveLength(1)
      expect(runners.get(runner)?.run).toHaveBeenCalledTimes(2)
    })

    test(`a ${runner} agent is not re-briefed on a task it already knows`, async () => {
      const task = aTask()
      await mentions.dispatch(task, `@on-${runner} first question`)

      await mentions.dispatch(task, `@on-${runner} and the follow-up?`)

      const second = runners.get(runner)?.run.mock.calls[1]?.[0] as string
      expect(second).toBe(`On ${task}: @on-${runner} and the follow-up?`)
      expect(second).not.toContain('You have been mentioned')
    })

    test(`a ${runner} agent's second turn is offered the CLI thread to resume`, async () => {
      const task = aTask()
      await mentions.dispatch(task, `@on-${runner} first question`)

      await mentions.dispatch(task, `@on-${runner} and the follow-up?`)

      // The manager offers it to every runner alike; what each one does with
      // it is the runner's own business — see the CustomRunner test below.
      expect(started.get(runner)?.[1]?.resumeFrom).toBe(`thread-${runner}`)
    })
  }
})

describe('the Roster tools a mentioned agent can answer with', () => {
  test('a Claude agent is handed them in-process', async () => {
    const task = aTask()

    await mentions.dispatch(task, '@on-claude have a look')

    expect(started.get('claude')?.[0]?.inProcessMcpServers).toBeDefined()
  })

  test('a Codex agent is handed them over the stdio bridge', async () => {
    const task = aTask()

    await mentions.dispatch(task, '@on-codex have a look')

    expect(started.get('codex')?.[0]?.mcpServers[ROSTER_SERVER]).toBeDefined()
  })

  test('a custom agent is handed neither, so it cannot comment or hand work on', async () => {
    // Not a bug in the mention path: SessionManager has no way to tell an
    // arbitrary CLI where an MCP server is. Recorded because it is the whole
    // difference between the three runners once the turn has started.
    const task = aTask()

    await mentions.dispatch(task, '@on-mine have a look')

    expect(started.get('mine')?.[0]?.inProcessMcpServers).toBeUndefined()
    expect(started.get('mine')?.[0]?.mcpServers[ROSTER_SERVER]).toBeUndefined()
  })
})

/**
 * The real `CustomRunner`, not a stub.
 *
 * The manager offers every runner `resumeFrom` (manager.ts:413), so the tests
 * above pass for all three. Whether the CLI behind one is actually resumed is
 * a separate question, and it is the one that decides whether a custom agent
 * can genuinely continue work rather than start over.
 */
describe('what a custom CLI actually does with the thread it is offered', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'roster-custom-resume-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** A CLI that reports the argv it was given, one event per argument. */
  async function argvEchoCli(): Promise<string> {
    const path = join(dir, 'argv-cli.js')
    await writeFile(
      path,
      `#!/usr/bin/env node\nfor (const text of process.argv.slice(2)) console.log(JSON.stringify({ type: 'item.completed', item: { id: 'i', type: 'agent_message', text } }))\n`,
      'utf8',
    )
    await chmod(path, 0o755)
    return path
  }

  test('drops it: the CLI is spawned exactly as it was on the first turn', async () => {
    // Arrange
    const cli = await argvEchoCli()
    const runner = new CustomRunner('mine', { command: cli, args: ['--json', '{prompt}'] }, 'codex')
    const options = {
      cwd: dir,
      model: 'a-model',
      systemPrompt: '',
      skillPaths: [],
      mcpServers: {},
      signal: new AbortController().signal,
    }

    // Act — the same call the manager makes on a resumed mention.
    const argv: string[] = []
    for await (const event of runner.run('and the follow-up?', {
      ...options,
      resumeFrom: 'thread-mine',
    })) {
      if (event.kind === 'text') argv.push(event.delta)
    }

    // Assert — nothing of the thread reached the process. A custom agent
    // mentioned a second time answers from a cold start, holding only the
    // one line the resumed prompt carries.
    expect(argv).toEqual(['--json', 'and the follow-up?'])
    expect(argv.join(' ')).not.toContain('thread-mine')
  })
})
