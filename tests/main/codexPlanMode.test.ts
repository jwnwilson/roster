import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CodexRunner, codexPlanPermissions } from '@main/runners/codex'
import type { RunnerEvent, StartOptions } from '@main/runners/types'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'roster-codexplanmode-'))
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

async function argv(overrides: Partial<StartOptions>): Promise<string[]> {
  const cli = await argvEchoCli()
  await mkdir(join(dir, '.git'), { recursive: true })
  const runner = new CodexRunner()
  ;(runner as unknown as { binary: string }).binary = cli

  const events: RunnerEvent[] = []
  for await (const event of runner.run('go', options(overrides))) events.push(event)
  return events.filter((event) => event.kind === 'text').map((event) => event.delta)
}

describe('the sandbox a planning turn runs under', () => {
  test('grants no writable path at all', () => {
    // Plan mode means research only. For Claude the SDK refuses every edit;
    // for Codex the equivalent is a profile with nothing writable in it.
    const overrides = codexPlanPermissions()

    expect(overrides.some((override) => override.includes('filesystem'))).toBe(false)
  })

  test('keeps network on, because research is the turn that needs it', () => {
    expect(codexPlanPermissions()).toContain('permissions.roster-plan.network.enabled=true')
  })

  test('is what a planning turn actually asks codex for', async () => {
    const args = await argv({ planMode: true })

    expect(args).toContain('default_permissions="roster-plan"')
    expect(args.some((arg) => arg.includes('roster-worktree'))).toBe(false)
  })

  test('a turn that is not planning keeps the writable worktree profile', async () => {
    const args = await argv({})

    expect(args).toContain('default_permissions="roster-worktree"')
    expect(args.some((arg) => arg.includes('roster-plan'))).toBe(false)
  })
})
