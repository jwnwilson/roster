import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { McpStore } from '@main/store/mcp'
import { seedIfEmpty } from '@main/store/seed'
import { mcpConfigPath } from '@main/store/paths'
import { defaultAgentsFor } from '@main/store/defaultAgents'
import { BROWSER_MCP_SERVERS, isBrowserMcpTool } from '@shared/mcp'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-browser-'))
  process.env['ROSTER_HOME'] = home
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

const names = BROWSER_MCP_SERVERS.map((server) => server.name)

describe('browser MCP servers', () => {
  test('are seeded on a fresh install', async () => {
    await seedIfEmpty(mcpConfigPath())
    const store = new McpStore()
    await store.load()
    expect(store.findAll().map((server) => server.name)).toEqual(expect.arrayContaining(names))
  })

  test('are added to an existing install without touching what is there', async () => {
    const store = new McpStore()
    await store.load()
    await store.install('playwright', 'my-own-playwright')

    const added = await store.ensure(BROWSER_MCP_SERVERS)

    expect(added).toEqual(['chrome-devtools'])
    const saved = JSON.parse(await readFile(mcpConfigPath(), 'utf8')) as { servers: { name: string; command: string }[] }
    expect(saved.servers.find((server) => server.name === 'playwright')?.command).toBe('my-own-playwright')
    expect(await store.ensure(BROWSER_MCP_SERVERS)).toEqual([])
  })

  test('are given to every starter agent', () => {
    const status = { id: 'pi', provider: 'Pi', installed: true, ready: true, auth: 'subscription' as const }
    for (const agent of defaultAgentsFor(new Map([['pi', status]]), { pi: 'anthropic/x' })) {
      expect(agent.mcpServers).toEqual(names)
    }
  })

  test('are recognised by tool name, and nothing else is', () => {
    expect(isBrowserMcpTool('mcp__playwright__browser_click')).toBe(true)
    expect(isBrowserMcpTool('mcp__chrome_devtools__list_console_messages')).toBe(true)
    expect(isBrowserMcpTool('mcp__github__create_issue')).toBe(false)
    expect(isBrowserMcpTool('playwright')).toBe(false)
  })
})
