import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent } from '@shared/types'
import { CustomRunner } from '@main/runners/custom'
import { CodexRunner } from '@main/runners/codex'
import { getRunner, isBuiltinRunner, registerCustomRunners } from '@main/runners/registry'
import { describeCommand } from '@main/runners/claude'
import type { RunnerEvent, StartOptions } from '@main/runners/types'

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
  const path = join(dir, 'argv-cli.sh')
  await writeFile(
    path,
    `#!/bin/sh\nfor a in "$@"; do printf '{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"%s"}}\\n' "$a"; done\n`,
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
