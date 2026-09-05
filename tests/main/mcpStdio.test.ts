import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpBridge } from '@main/runners/mcpBridge'
import { connectToBridge, createProxyServer } from '@main/runners/mcpStdio'
import { defineTool, type BuiltinToolDefinition } from '@main/runners/toolDefinitions'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/**
 * The whole path a Codex agent's tool call actually takes: an MCP client
 * talking to the stdio server, which talks to the bridge over its socket,
 * which runs the handler Roster built. Only the pipe between `codex exec` and
 * the child is left out, and that is the one part neither side owns.
 */
async function wire(handler: ReturnType<typeof vi.fn>): Promise<Client> {
  const move = defineTool(
    'move_it',
    'Moves a card, for the tests.',
    { task_id: z.string(), column: z.enum(['todo', 'done']).optional() },
    handler as never,
  )

  const bridge = await McpBridge.start([
    { ...move, server: 'tasks' } as unknown as BuiltinToolDefinition,
  ])
  cleanups.push(() => bridge.close())

  const bridgeClient = await connectToBridge(bridge.address, bridge.token)
  cleanups.push(async () => bridgeClient.close())

  const server = await createProxyServer(bridgeClient)
  const client = new Client({ name: 'test', version: '1.0.0' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await Promise.all([client.connect(clientSide), server.connect(serverSide)])
  cleanups.push(async () => client.close())

  return client
}

describe('the stdio MCP server a Codex agent spawns', () => {
  test('offers the tools the bridge holds, with their schemas', async () => {
    const client = await wire(vi.fn(async () => ({ content: [] })))

    const { tools } = await client.listTools()

    expect(tools).toHaveLength(1)
    expect(tools[0]?.name).toBe('move_it')
    expect(tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: { task_id: { type: 'string' } },
    })
  })

  test('says the tools are not destructive, or Codex will never run them', async () => {
    const client = await wire(vi.fn(async () => ({ content: [] })))

    const { tools } = await client.listTools()

    expect(tools[0]?.annotations).toMatchObject({
      destructiveHint: false,
      openWorldHint: false,
    })
  })

  test('carries a call through to the handler in the main process', async () => {
    const handler = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'Updated. ROS-1 [done]' }],
    }))
    const client = await wire(handler)

    const result = await client.callTool({
      name: 'move_it',
      arguments: { task_id: 'ROS-1', column: 'done' },
    })

    expect(handler).toHaveBeenCalledWith({ task_id: 'ROS-1', column: 'done' }, undefined)
    expect(result.content).toEqual([{ type: 'text', text: 'Updated. ROS-1 [done]' }])
  })

  test('reports a refused call as a tool error rather than a protocol failure', async () => {
    const handler = vi.fn(async () => ({ content: [] }))
    const client = await wire(handler)

    // `task_id` is required, so the bridge rejects this before the handler.
    const result = await client.callTool({ name: 'move_it', arguments: { column: 'done' } })

    expect(handler).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })

  test('carries several calls, since a turn makes more than one', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }))
    const client = await wire(handler)

    await client.callTool({ name: 'move_it', arguments: { task_id: 'ROS-1' } })
    await client.callTool({ name: 'move_it', arguments: { task_id: 'ROS-2' } })

    expect(handler).toHaveBeenCalledTimes(2)
  })
})

describe('what the stdio server does when it cannot reach Roster', () => {
  test('refuses to connect with the wrong token', async () => {
    const bridge = await McpBridge.start([])
    cleanups.push(() => bridge.close())

    await expect(connectToBridge(bridge.address, 'not-the-token')).rejects.toThrow()
  })

  test('refuses to connect to an address with nothing listening', async () => {
    await expect(connectToBridge('/tmp/roster-mcp-nothing-here/s', 'x')).rejects.toThrow()
  })
})

describe('when Roster goes away mid-turn', () => {
  test('a call in flight is answered as an error rather than hanging forever', async () => {
    // The turn ended and the bridge closed while the child was still asking.
    // Without this the promise never settles and the agent waits for good.
    const bridge = await McpBridge.start([])
    const client = await connectToBridge(bridge.address, bridge.token)

    const inFlight = client.call('anything', {})
    await bridge.close()

    await expect(inFlight).resolves.toMatchObject({ isError: true })
  })
})

describe('the child’s own lifetime', () => {
  test('is told when Roster is gone, which is what stops it outliving a turn', async () => {
    const bridge = await McpBridge.start([])
    const client = await connectToBridge(bridge.address, bridge.token)

    const lost = new Promise<string>((resolve) => client.onLost(() => resolve('gone')))
    await bridge.close()

    await expect(lost).resolves.toBe('gone')
  })

  test('is not told when it closed the connection itself', async () => {
    const bridge = await McpBridge.start([])
    cleanups.push(() => bridge.close())
    const client = await connectToBridge(bridge.address, bridge.token)

    const onLost = vi.fn()
    client.onLost(onLost)
    client.close()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(onLost).not.toHaveBeenCalled()
  })
})

describe('a bridge sending something unreadable', () => {
  test('ends the connection instead of taking the process down', async () => {
    // The bridge only ever writes JSON, so this cannot happen today. It is
    // guarded because this file is the one piece of Roster running outside
    // the main process, and a throw inside a socket handler is an uncaught
    // exception that kills it.
    const bridge = await McpBridge.start([])
    cleanups.push(() => bridge.close())
    const client = await connectToBridge(bridge.address, bridge.token)

    const lost = new Promise<string>((resolve) => client.onLost(() => resolve('gone')))
    const inFlight = client.call('anything', {})

    // Reach past the bridge and write a line that is not JSON.
    for (const socket of (bridge as unknown as { open: Set<{ write(s: string): void }> }).open) {
      socket.write('not json at all\n')
    }

    await expect(lost).resolves.toBe('gone')
    await expect(inFlight).resolves.toMatchObject({ isError: true })
  })
})
