import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CodexRunner, codexMcpOverrides } from '@main/runners/codex'
import type { RunnerEvent, StartOptions } from '@main/runners/types'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'roster-codexmcp-'))
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

describe('the config overrides that register an MCP server with Codex', () => {
  test('name the command, its arguments and its environment', () => {
    expect(
      codexMcpOverrides({
        roster: { command: '/usr/bin/node', args: ['/app/mcpStdio.js'], env: { TOKEN: 'abc' } },
      }),
    ).toEqual([
      'mcp_servers.roster.command="/usr/bin/node"',
      'mcp_servers.roster.args=["/app/mcpStdio.js"]',
      'mcp_servers.roster.env={"TOKEN"="abc"}',
    ])
  })

  test('leave out the arguments and environment a server does not have', () => {
    expect(codexMcpOverrides({ plain: { command: 'thing', args: [], env: {} } })).toEqual([
      'mcp_servers.plain.command="thing"',
    ])
  })

  test('quote every value, so a path with a space or a quote cannot break the TOML', () => {
    const [command, args] = codexMcpOverrides({
      awkward: {
        command: '/Applications/My "App"/node',
        args: ['/a b/c.js'],
        env: {},
      },
    })

    expect(command).toBe('mcp_servers.awkward.command="/Applications/My \\"App\\"/node"')
    expect(args).toBe('mcp_servers.awkward.args=["/a b/c.js"]')
  })

  test('produce nothing at all when the agent has no servers', () => {
    expect(codexMcpOverrides({})).toEqual([])
  })
})

describe('what the Codex CLI is actually launched with', () => {
  test('registers the agent’s MCP servers on an initial turn', async () => {
    const args = await argv({
      mcpServers: { roster: { command: '/bin/node', args: ['/s.js'], env: {} } },
    })

    expect(args).toContain('mcp_servers.roster.command="/bin/node"')
    expect(args).toContain('mcp_servers.roster.args=["/s.js"]')
  })

  test('registers them again on a resumed turn, which is a fresh process', async () => {
    const args = await argv({
      resumeFrom: 'thread-1',
      mcpServers: { roster: { command: '/bin/node', args: ['/s.js'], env: {} } },
    })

    expect(args).toContain('mcp_servers.roster.command="/bin/node"')
    // The prompt is still last, and the thread id still just before it.
    expect(args.slice(-2)).toEqual(['thread-1', 'go'])
  })

  test('adds no MCP arguments for an agent with no servers, as before', async () => {
    const args = await argv({})

    expect(args.filter((arg) => arg.startsWith('mcp_servers.'))).toEqual([])
  })

  test('keeps the sandbox overrides alongside the servers', async () => {
    const args = await argv({
      mcpServers: { roster: { command: '/bin/node', args: [], env: {} } },
    })

    expect(args).toContain('default_permissions="roster-worktree"')
    expect(args).toContain('mcp_servers.roster.command="/bin/node"')
  })
})

describe('a server name Codex cannot be given', () => {
  test('is left out rather than nesting the server somewhere else', () => {
    const written: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk))
      return true
    }) as typeof process.stderr.write

    try {
      expect(
        codexMcpOverrides({
          'sneaky.command="/bin/sh"\nx': { command: 'evil', args: [], env: {} },
          fine: { command: 'ok', args: [], env: {} },
        }),
      ).toEqual(['mcp_servers.fine.command="ok"'])
    } finally {
      process.stderr.write = original
    }

    expect(written.join('')).toContain('is not a name Codex can be given')
  })
})
