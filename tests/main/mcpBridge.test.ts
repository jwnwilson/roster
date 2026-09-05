import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { McpBridge, bridgeAddress } from '@main/runners/mcpBridge'
import { defineTool, type BuiltinToolDefinition } from '@main/runners/toolDefinitions'

const bridges: McpBridge[] = []

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()))
})

function toolset(handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }))) {
  const echo = defineTool(
    'echo_it',
    'Echoes what it is given, for the tests.',
    { word: z.string(), times: z.number().optional() },
    handler as never,
  )
  return { handler, tools: [{ ...echo, server: 'roster' }] as unknown as BuiltinToolDefinition[] }
}

async function start(tools: BuiltinToolDefinition[]): Promise<McpBridge> {
  const bridge = await McpBridge.start(tools)
  bridges.push(bridge)
  return bridge
}

/** One request/response over the bridge's own line protocol. */
function ask(
  bridge: McpBridge,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(bridge.address)
    let buffer = ''
    socket.on('error', reject)
    socket.on('close', () => reject(new Error('the bridge closed the connection')))
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      const end = buffer.indexOf('\n')
      if (end < 0) return
      socket.destroy()
      resolve(JSON.parse(buffer.slice(0, end)) as Record<string, unknown>)
    })
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
  })
}

describe('the socket the bridge listens on', () => {
  test('sits in a directory only this user can enter', async () => {
    // The whole access control, and it comes from mkdtemp rather than from
    // anything this code passes — so it is worth asserting rather than
    // assuming. Windows has no POSIX modes and uses a named pipe instead.
    const bridge = await start(toolset().tools)

    const mode = (await stat(bridge.dir)).mode & 0o777
    expect(mode.toString(8)).toBe('700')
  })
})

describe('the address the bridge listens on', () => {
  test('is a socket file inside the directory it was given, on a unix', () => {
    expect(bridgeAddress('darwin', '/tmp/roster-mcp-abc')).toBe('/tmp/roster-mcp-abc/s')
    expect(bridgeAddress('linux', '/tmp/roster-mcp-abc')).toBe('/tmp/roster-mcp-abc/s')
  })

  test('is a named pipe on Windows, which has no socket files', () => {
    expect(bridgeAddress('win32', 'C:\\Temp\\roster-mcp-abc')).toMatch(/^\\\\[.]\\pipe\\/)
  })
})

describe('the bridge a Codex agent calls back through', () => {
  test('lists the tools it was given, in their wire form', async () => {
    const { tools } = toolset()
    const bridge = await start(tools)

    const reply = await ask(bridge, { id: 1, op: 'list', token: bridge.token })

    expect(reply['id']).toBe(1)
    expect(reply['tools']).toMatchObject([
      { name: 'echo_it', annotations: { destructiveHint: false, openWorldHint: false } },
    ])
  })

  test('runs the handler for a call and returns what it produced', async () => {
    const { handler, tools } = toolset()
    const bridge = await start(tools)

    const reply = await ask(bridge, {
      id: 7,
      op: 'call',
      token: bridge.token,
      name: 'echo_it',
      args: { word: 'hello' },
    })

    expect(handler).toHaveBeenCalledWith({ word: 'hello' }, undefined)
    expect(reply).toMatchObject({ id: 7, content: [{ type: 'text', text: 'ok' }] })
  })

  test('serves more than one connection, since Codex starts the server twice', async () => {
    const { tools } = toolset()
    const bridge = await start(tools)

    await ask(bridge, { id: 1, op: 'list', token: bridge.token })
    const second = await ask(bridge, { id: 2, op: 'list', token: bridge.token })

    expect(second['tools']).toHaveLength(1)
  })
})

describe('what the bridge refuses', () => {
  test('drops a connection that does not present the token', async () => {
    const { handler, tools } = toolset()
    const bridge = await start(tools)

    await expect(
      ask(bridge, { id: 1, op: 'call', token: 'guessed', name: 'echo_it', args: { word: 'x' } }),
    ).rejects.toThrow(/closed the connection/)
    expect(handler).not.toHaveBeenCalled()
  })

  test('drops a connection presenting no token at all', async () => {
    const { tools } = toolset()
    const bridge = await start(tools)

    await expect(ask(bridge, { id: 1, op: 'list' })).rejects.toThrow(/closed the connection/)
  })

  test('answers a call to a tool it does not have, rather than dropping it', async () => {
    const { tools } = toolset()
    const bridge = await start(tools)

    const reply = await ask(bridge, {
      id: 3,
      op: 'call',
      token: bridge.token,
      name: 'rm_rf',
      args: {},
    })

    expect(reply['isError']).toBe(true)
    expect(JSON.stringify(reply['content'])).toContain('rm_rf')
  })

  test('refuses arguments that do not match the tool\u2019s schema, without running it', async () => {
    const { handler, tools } = toolset()
    const bridge = await start(tools)

    const reply = await ask(bridge, {
      id: 4,
      op: 'call',
      token: bridge.token,
      name: 'echo_it',
      // `word` is required and a string; a number is not one.
      args: { word: 42 },
    })

    expect(handler).not.toHaveBeenCalled()
    expect(reply['isError']).toBe(true)
  })

  test('refuses arguments that are not an object at all', async () => {
    const { handler, tools } = toolset()
    const bridge = await start(tools)

    const reply = await ask(bridge, {
      id: 5,
      op: 'call',
      token: bridge.token,
      name: 'echo_it',
      args: 'not an object',
    })

    expect(handler).not.toHaveBeenCalled()
    expect(reply['isError']).toBe(true)
  })

  test('turns a handler that throws into an error the agent can read', async () => {
    const { tools } = toolset(
      vi.fn(async () => {
        throw new Error('the store said no')
      }),
    )
    const bridge = await start(tools)

    const reply = await ask(bridge, {
      id: 6,
      op: 'call',
      token: bridge.token,
      name: 'echo_it',
      args: { word: 'x' },
    })

    expect(reply['isError']).toBe(true)
    expect(JSON.stringify(reply['content'])).toContain('the store said no')
  })

  test('ignores an operation it does not know', async () => {
    const { tools } = toolset()
    const bridge = await start(tools)

    const reply = await ask(bridge, { id: 8, op: 'delete_everything', token: bridge.token })

    expect(reply['error']).toMatch(/delete_everything/)
  })
})

describe('how the bridge is launched and torn down', () => {
  test('describes a child that runs Roster\u2019s own binary as Node', async () => {
    const { tools } = toolset()
    const bridge = await start(tools)

    const spec = bridge.launchSpec()

    expect(spec.command).toBe(process.execPath)
    expect(spec.args[0]).toMatch(/mcpStdio\.(js|ts|mjs)$/)
    // Codex hands its MCP children a scrubbed environment, so anything the
    // child needs has to be named here rather than inherited.
    expect(spec.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      ROSTER_MCP_SOCKET: bridge.address,
      ROSTER_MCP_TOKEN: bridge.token,
    })
  })

  test('takes the socket and its directory away when it closes', async () => {
    const { tools } = toolset()
    const bridge = await McpBridge.start(tools)

    expect(existsSync(bridge.address)).toBe(true)
    await bridge.close()

    expect(existsSync(bridge.address)).toBe(false)
  })

  test('can be closed twice, since a turn that failed also tears down', async () => {
    const { tools } = toolset()
    const bridge = await McpBridge.start(tools)

    await bridge.close()
    await expect(bridge.close()).resolves.toBeUndefined()
  })

  test('gives every bridge its own token, so one session cannot use another\u2019s', async () => {
    const first = await start(toolset().tools)
    const second = await start(toolset().tools)

    expect(first.token).not.toBe(second.token)
    await expect(ask(second, { id: 1, op: 'list', token: first.token })).rejects.toThrow()
  })
})
