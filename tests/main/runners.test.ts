import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent } from '@shared/types'
import { CustomRunner } from '@main/runners/custom'
import { CodexRunner, codexPermissionOverrides } from '@main/runners/codex'
import { getRunner, isBuiltinRunner, registerCustomRunners } from '@main/runners/registry'
import { ClaudeRunner, describeCommand } from '@main/runners/claude'
import type { RunnerEvent, StartOptions } from '@main/runners/types'
import { worktreesDir } from '@main/store/paths'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'roster-runner-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function options(overrides: Partial<StartOptions> = {}): StartOptions {
  return {
    cwd: dir,
    model: 'my-model',
    systemPrompt: '',
    skillPaths: [],
    mcpServers: {},
    signal: new AbortController().signal,
    ...overrides,
  }
}

async function collect(iterable: AsyncIterable<RunnerEvent>): Promise<RunnerEvent[]> {
  const events: RunnerEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

/** A CLI that prints the argv it was given, one JSON line per argument. */
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

describe('CustomRunner — argument templating', () => {
  test('substitutes the prompt into the declared template', async () => {
    const cli = await argvEchoCli()
    const runner = new CustomRunner('mine', { command: cli, args: ['--ask', '{prompt}'] }, 'codex')

    const events = await collect(runner.run('find the leak', options()))

    expect(events.filter((e) => e.kind === 'text').map((e) => e.delta)).toEqual([
      '--ask',
      'find the leak',
    ])
  })

  test('substitutes model, cwd, and system prompt', async () => {
    const cli = await argvEchoCli()
    const runner = new CustomRunner(
      'mine',
      { command: cli, args: ['{model}', '{cwd}', '{system}', '{prompt}'] },
      'codex',
    )

    const events = await collect(
      runner.run('go', options({ systemPrompt: 'house rules' })),
    )

    const texts = events.filter((e) => e.kind === 'text').map((e) => e.delta)
    expect(texts).toEqual(['my-model', dir, 'house rules', 'go'])
  })

  test('appends the prompt when the template does not place it', async () => {
    // A bare command like `mytool --json` should still receive the prompt.
    const cli = await argvEchoCli()
    const runner = new CustomRunner('mine', { command: cli, args: ['--json'] }, 'codex')

    const events = await collect(runner.run('go', options()))

    expect(events.filter((e) => e.kind === 'text').map((e) => e.delta)).toEqual(['--json', 'go'])
  })

  test('offers no model catalogue, since a user CLI has none to read', async () => {
    const runner = new CustomRunner('mine', { command: 'x', args: [] })
    expect(await runner.models()).toEqual([])
  })

  test('reports a missing binary rather than claiming it is ready', async () => {
    const runner = new CustomRunner('nope-not-real', { command: 'nope-not-real', args: [] })
    const status = await runner.detect()

    expect(status.ready).toBe(false)
    expect(status.provider).toBe('Custom')
  })

  test('answering an approval is a no-op, since a user CLI has no callback', () => {
    const runner = new CustomRunner('mine', { command: 'x', args: [] })
    expect(() => runner.respondToApproval('a', { approved: true })).not.toThrow()
  })
})

describe('CodexRunner', () => {
  test('passes least-privilege Git permissions and the working directory to an initial turn', async () => {
    const cli = await argvEchoCli()
    await mkdir(join(dir, '.git'))
    const runner = new CodexRunner()
    ;(runner as unknown as { binary: string }).binary = cli

    const events = await collect(runner.run('go', options()))

    expect(events.filter((event) => event.kind === 'text').map((event) => event.delta)).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--strict-config',
      '--config',
      'default_permissions="roster-worktree"',
      '--config',
      'permissions.roster-worktree.extends=":workspace"',
      '--config',
      `permissions.roster-worktree.filesystem={${[
        join(dir, '.git'),
        worktreesDir(),
      ].map((path) => `${JSON.stringify(path)}="write"`)}}`,
      '-C',
      dir,
      '--model',
      'my-model',
      'go',
    ])
  })

  test('uses only resume-supported options for a follow-up turn', async () => {
    const cli = await argvEchoCli()
    await mkdir(join(dir, '.git'))
    const runner = new CodexRunner()
    ;(runner as unknown as { binary: string }).binary = cli

    const events = await collect(runner.run('go again', options({ resumeFrom: 'thread-1' })))

    expect(events.filter((event) => event.kind === 'text').map((event) => event.delta)).toEqual([
      'exec',
      'resume',
      '--json',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--strict-config',
      '--config',
      'default_permissions="roster-worktree"',
      '--config',
      'permissions.roster-worktree.extends=":workspace"',
      '--config',
      `permissions.roster-worktree.filesystem={${[
        join(dir, '.git'),
        worktreesDir(),
      ].map((path) => `${JSON.stringify(path)}="write"`)}}`,
      '--model',
      'my-model',
      'thread-1',
      'go again',
    ])
  })

  test('allows both worktree-specific and common Git metadata', async () => {
    const checkout = join(dir, 'checkout')
    const common = join(dir, 'main', '.git')
    const gitDir = join(common, 'worktrees', 'checkout')
    await mkdir(checkout)
    await mkdir(gitDir, { recursive: true })
    await writeFile(join(checkout, '.git'), `gitdir: ${gitDir}\n`, 'utf8')
    await writeFile(join(gitDir, 'commondir'), '../..\n', 'utf8')

    expect(codexPermissionOverrides(checkout, join(dir, 'Roster Worktrees'))).toEqual([
      'default_permissions="roster-worktree"',
      'permissions.roster-worktree.extends=":workspace"',
      `permissions.roster-worktree.filesystem={${[
        gitDir,
        common,
        join(dir, 'Roster Worktrees'),
      ].map((path) => `${JSON.stringify(path)}="write"`)}}`,
    ])
  })

  test('quotes permission paths as TOML keys', async () => {
    const checkout = join(dir, 'a "quoted" checkout')
    const gitDir = join(checkout, '.git')
    await mkdir(gitDir, { recursive: true })
    const destination = join(dir, 'slash\\and "quote"')

    const overrides = codexPermissionOverrides(checkout, destination)

    expect(overrides).toContain(
      `permissions.roster-worktree.filesystem={${[gitDir, destination].map(
        (path) => `${JSON.stringify(path)}="write"`,
      )}}`,
    )
    expect(
      overrides.some((override) =>
        override.startsWith('permissions.roster-worktree.filesystem."'),
      ),
    ).toBe(false)
  })

  test('falls back to a known model list when the cache is unreadable', async () => {
    const runner = new CodexRunner()
    const models = await runner.models()

    expect(models.length).toBeGreaterThan(0)
    // Codex publishes no prices, so the column stays empty rather than invented.
    expect(models.every((m) => m.price === '')).toBe(true)
  })

  test('never offers the internal review model as a session model', async () => {
    const runner = new CodexRunner()
    const models = await runner.models()

    expect(models.map((m) => m.id)).not.toContain('codex-auto-review')
  })

  test('answering an approval is a no-op, since Codex gates via its sandbox', () => {
    const runner = new CodexRunner()
    expect(() => runner.respondToApproval()).not.toThrow()
  })
})

describe('registry', () => {
  test('resolves the builtin runners', () => {
    expect(getRunner('claude')?.id).toBe('claude')
    expect(getRunner('codex')?.id).toBe('codex')
  })

  test('returns nothing for a runner it has never heard of', () => {
    expect(getRunner('ghost')).toBeNull()
  })

  test('recognises which ids are builtin', () => {
    expect(isBuiltinRunner('claude')).toBe(true)
    expect(isBuiltinRunner('mine')).toBe(false)
  })

  test('registers a runner for an agent that declares a custom command', () => {
    const agent: Agent = {
      id: 'a',
      name: 'Custom Agent',
      runner: 'my-cli',
      model: 'm',
      cwd: '/tmp',
      cwdLabel: '/tmp',
      systemPrompt: '',
      skills: [],
      mcpServers: [],
      hidden: false,
      custom: { command: 'my-cli', args: ['--json'] },
      status: 'idle',
    }

    registerCustomRunners([agent])
    expect(getRunner('my-cli')?.id).toBe('my-cli')
  })

  test('ignores an agent whose runner is builtin', () => {
    const before = getRunner('claude')
    registerCustomRunners([
      {
        id: 'b',
        name: 'B',
        runner: 'claude',
        model: 'm',
        cwd: '/tmp',
        cwdLabel: '/tmp',
        systemPrompt: '',
        skills: [],
        mcpServers: [],
        hidden: false,
        status: 'idle',
      },
    ])

    // The builtin must not be replaced by a custom wrapper.
    expect(getRunner('claude')).toBe(before)
  })

  test('ignores a non-builtin runner with no custom block', () => {
    registerCustomRunners([
      {
        id: 'c',
        name: 'C',
        runner: 'incomplete',
        model: 'm',
        cwd: '/tmp',
        cwdLabel: '/tmp',
        systemPrompt: '',
        skills: [],
        mcpServers: [],
        hidden: false,
        status: 'idle',
      },
    ])

    expect(getRunner('incomplete')).toBeNull()
  })
})

describe('describeCommand', () => {
  test('names the shell command when there is one', () => {
    expect(describeCommand('Bash', { command: 'git push --force' })).toBe('git push --force')
  })

  test('names the file for a write', () => {
    expect(describeCommand('Write', { file_path: '/work/api/pool.ts' })).toBe('/work/api/pool.ts')
  })

  test('falls back to the tool name when nothing stands out', () => {
    expect(describeCommand('WebSearch', { detail: 42 })).toBe('WebSearch')
  })

  test('names the plan being approved, not the tool that presents it', () => {
    expect(describeCommand('ExitPlanMode', { plan: '## Fix the leak\n\nsteps' })).toBe(
      '## Fix the leak',
    )
  })

  test('names what a question tool is asking, since it has no command', () => {
    // "AskUserQuestion" on the banner says nothing about what is being asked.
    const input = { questions: [{ question: 'Which cache backend?', options: [] }] }

    expect(describeCommand('AskUserQuestion', input)).toBe('Which cache backend?')
  })

  test('ignores an empty field rather than showing a blank banner', () => {
    expect(describeCommand('Bash', { command: '' })).toBe('Bash')
  })
})

describe('answering a question through the approval gate', () => {
  const QUESTIONS = [
    {
      question: 'Which cache backend?',
      header: 'Cache',
      multiSelect: false,
      options: [{ label: 'Redis', description: 'Distributed' }, { label: 'None', description: '' }],
    },
  ]

  /** requestApproval is private; the gate is what this suite is about. */
  function gateOf(runner: ClaudeRunner) {
    return (
      runner as unknown as {
        requestApproval(
          toolName: string,
          input: Record<string, unknown>,
        ): Promise<Record<string, unknown>>
      }
    ).requestApproval.bind(runner)
  }

  function raise(input: Record<string, unknown>, toolName = 'AskUserQuestion') {
    const runner = new ClaudeRunner()
    const raised: { id: string; questions?: unknown }[] = []
    runner.onApprovalNeeded = (event) => raised.push(event)

    const settled = gateOf(runner)(toolName, input)
    return { runner, raised, settled }
  }

  test('the approval carries the questions, so the UI can draw them', () => {
    const { raised } = raise({ questions: QUESTIONS })

    expect(raised[0]?.questions).toEqual(QUESTIONS)
  })

  test('an ordinary tool raises an approval with no questions on it', () => {
    const { raised } = raise({ command: 'git push' }, 'Bash')

    expect(raised[0]).not.toHaveProperty('questions')
  })

  test('answers reach the tool as its own input, not as a denial', async () => {
    const { runner, raised, settled } = raise({ questions: QUESTIONS })

    runner.respondToApproval(raised[0]!.id, {
      approved: true,
      answers: { 'Which cache backend?': 'Redis' },
    })

    // The tool reads its answers back out of the input it was called with, so
    // allowing the call and answering the question are one act.
    expect(await settled).toEqual({
      behavior: 'allow',
      updatedInput: { questions: QUESTIONS, answers: { 'Which cache backend?': 'Redis' } },
    })
  })

  test('skipping allows the call untouched, so the tool says nobody answered', async () => {
    const { runner, raised, settled } = raise({ questions: QUESTIONS })

    runner.respondToApproval(raised[0]!.id, { approved: true, answers: {} })

    // Not a denial: "the user did not answer" is truer than an error.
    expect(await settled).toEqual({ behavior: 'allow', updatedInput: { questions: QUESTIONS } })
  })

  test('an ordinary approval is unchanged by all this', async () => {
    const { runner, raised, settled } = raise({ command: 'git push' }, 'Bash')

    runner.respondToApproval(raised[0]!.id, { approved: true })

    expect(await settled).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'git push' },
    })
  })

  test('a denial still denies, and says why', async () => {
    const { runner, raised, settled } = raise({ questions: QUESTIONS })

    runner.respondToApproval(raised[0]!.id, { approved: false, reason: 'no thanks' })

    expect(await settled).toEqual({ behavior: 'deny', message: 'no thanks' })
  })
})

describe('in-process tool allowlists', () => {
  // A tool that is registered but not allowlisted does not fail loudly — it
  // silently blocks on the approval gate, which is how the task tools shipped
  // unusable the first time. Both servers get the same check.

  test('the handoff server registers exactly the tools it allowlists', async () => {
    const { ROSTER_TOOL_NAMES, createRosterMcpServer } = await import('@main/runners/handoffTool')

    const server = (await createRosterMcpServer(
      { listAgents: () => [], openSession: () => ({ sessionId: 's', label: 'l' }) },
      'me',
    )) as { instance?: { _registeredTools?: Record<string, unknown> } }

    const registered = Object.keys(server.instance?._registeredTools ?? {})
    expect(registered).toHaveLength(ROSTER_TOOL_NAMES.length)
    for (const name of registered) {
      expect(ROSTER_TOOL_NAMES).toContain(`mcp__roster__${name}`)
    }
  })

  test('the task server registers exactly the tools it allowlists', async () => {
    const { TASK_TOOL_NAMES, createTasksMcpServer } = await import('@main/runners/taskTools')

    const server = (await createTasksMcpServer(
      {
        list: () => [],
        find: () => null,
        comments: () => [],
        projectName: () => null,
        isArchivedProject: () => false,
        agentName: () => null,
        create: () => ({}) as never,
        update: () => ({}) as never,
        comment: () => {},
      },
      'me',
    )) as { instance?: { _registeredTools?: Record<string, unknown> } }

    const registered = Object.keys(server.instance?._registeredTools ?? {})
    expect(registered).toHaveLength(TASK_TOOL_NAMES.length)
    for (const name of registered) {
      expect(TASK_TOOL_NAMES).toContain(`mcp__tasks__${name}`)
    }
  })

  test('the runner allowlists every tool from both servers', async () => {
    const { ROSTER_TOOL_NAMES } = await import('@main/runners/handoffTool')
    const { TASK_TOOL_NAMES } = await import('@main/runners/taskTools')

    // Namespaces must not collide: an agent with both enabled sees one flat
    // tool list, and a duplicate name there is ambiguous.
    const all = [...ROSTER_TOOL_NAMES, ...TASK_TOOL_NAMES]
    expect(new Set(all).size).toBe(all.length)
  })
})
