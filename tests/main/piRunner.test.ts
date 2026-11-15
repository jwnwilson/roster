import { describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import type { Agent } from '@shared/types'
import {
  addUsage,
  createPiNormalizer,
  describeArgs,
  EMPTY_TOTALS,
  resultText,
  totalsFrom,
} from '@main/runners/pi/normalize'
import { migrateModelName, modelKey, priceLabel, resolveModel, toModelInfo } from '@main/runners/pi/models'
import { EventQueue, PiRunner, toPiTool } from '@main/runners/pi/runner'
import { migrateAgentsToPi } from '@main/store/migratePi'
import type { BuiltinToolDefinition } from '@main/runners/toolDefinitions'
import { contextWindowFor } from '@shared/models'

const usage = (input: number, output: number, cost: number, cacheRead = 0) => ({
  input,
  output,
  cacheRead,
  cacheWrite: 0,
  totalTokens: input + output + cacheRead,
  cost: { total: cost },
})

describe('Pi normalizer', () => {
  test('streams assistant prose as text deltas', () => {
    const n = createPiNormalizer()
    expect(
      n.handle({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hi' } }),
    ).toEqual([{ kind: 'text', delta: 'Hi' }])
    expect(n.handle({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '' } })).toEqual([])
    expect(n.handle({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'x' } })).toEqual([])
  })

  test('turns tool execution into a tool row and its result', () => {
    const n = createPiNormalizer()
    expect(
      n.handle({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } }),
    ).toEqual([{ kind: 'tool', id: 't1', name: 'bash', args: 'ls', input: '{\n  "command": "ls"\n}' }])
    expect(
      n.handle({
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'a\nb' }] },
        isError: false,
      }),
    ).toEqual([{ kind: 'result', id: 't1', output: 'a\nb', isError: false }])
  })

  test('leaves propose_plan to the row its handler writes', () => {
    const n = createPiNormalizer()
    expect(n.handle({ type: 'tool_execution_start', toolCallId: 'p', toolName: 'propose_plan', args: {} })).toEqual([])
    expect(n.handle({ type: 'tool_execution_end', toolCallId: 'p', result: {} })).toEqual([])
  })

  test('ignores tool events with no id', () => {
    const n = createPiNormalizer()
    expect(n.handle({ type: 'tool_execution_start', toolName: 'bash' })).toEqual([])
    expect(n.handle({ type: 'tool_execution_end' })).toEqual([])
  })

  test('reports a running session total after each assistant message', () => {
    const n = createPiNormalizer()
    n.handle({ type: 'message_end', message: { role: 'assistant', usage: usage(100, 10, 0.5, 50) } })
    const [event] = n.handle({ type: 'message_end', message: { role: 'assistant', usage: usage(20, 5, 0.25) } })
    expect(event).toEqual({
      kind: 'usage',
      inputTokens: 120,
      cachedInputTokens: 50,
      outputTokens: 15,
      totalTokens: 185,
      costUsd: 0.75,
    })
  })

  test('starts from what a resumed session had already spent', () => {
    const prior = totalsFrom([
      { role: 'user', content: 'hi' },
      { role: 'assistant', usage: usage(10, 1, 1) },
    ])
    const n = createPiNormalizer(prior)
    const [event] = n.handle({ type: 'message_end', message: { role: 'assistant', usage: usage(10, 1, 1) } })
    expect(event).toMatchObject({ kind: 'usage', inputTokens: 20, costUsd: 2 })
  })

  test('surfaces a failed model request as an error', () => {
    const n = createPiNormalizer()
    const events = n.handle({
      type: 'message_end',
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'rate limited' },
    })
    expect(events).toContainEqual({ kind: 'error', message: 'rate limited' })
    expect(
      n.handle({ type: 'message_end', message: { role: 'assistant', stopReason: 'error' } }),
    ).toContainEqual({ kind: 'error', message: 'the model request failed' })
  })

  test('ignores user messages and unknown events', () => {
    const n = createPiNormalizer()
    expect(n.handle({ type: 'message_end', message: { role: 'user' } })).toEqual([])
    expect(n.handle({ type: 'agent_start' })).toEqual([])
    expect(n.handle(null)).toEqual([])
  })

  test('addUsage tolerates missing usage and derives a total', () => {
    expect(addUsage(EMPTY_TOTALS, undefined)).toBe(EMPTY_TOTALS)
    expect(addUsage(EMPTY_TOTALS, { input: 1, output: 2 }).totalTokens).toBe(3)
  })

  test('describeArgs prefers the most telling field', () => {
    expect(describeArgs('read', { path: 'a.ts' })).toBe('a.ts')
    expect(describeArgs('list_agents', {})).toBe('')
    expect(describeArgs('x', { a: 1 })).toBe('{"a":1}')
    expect(describeArgs('x', { a: 'y'.repeat(200) }).endsWith('...')).toBe(true)
  })

  test('resultText joins text and names other content', () => {
    expect(resultText('plain')).toBe('plain')
    expect(resultText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }] })).toBe('a\n[image]')
    expect(resultText({})).toBe('')
    expect(resultText(42)).toBe('')
  })
})

describe('Pi models', () => {
  const models = [
    { provider: 'anthropic', id: 'claude-sonnet-5', cost: { input: 2, output: 10 } },
    { provider: 'openai-codex', id: 'gpt-5.5', cost: { input: 0, output: 0 } },
    { provider: 'xai', id: 'grok-4.7', cost: { input: 1.25, output: 2.5 } },
  ]

  test('names models provider/id with a price', () => {
    expect(modelKey(models[0]!)).toBe('anthropic/claude-sonnet-5')
    expect(toModelInfo(models)).toEqual([
      { id: 'anthropic/claude-sonnet-5', price: '$2 / $10' },
      { id: 'openai-codex/gpt-5.5', price: '' },
      { id: 'xai/grok-4.7', price: '$1.25 / $2.5' },
    ])
    expect(priceLabel({ provider: 'p', id: 'm' })).toBe('')
  })

  test('resolves qualified ids, bare ids and blanks', () => {
    expect(resolveModel('xai/grok-4.7', models)?.id).toBe('grok-4.7')
    expect(resolveModel('claude-sonnet-5', models)?.provider).toBe('anthropic')
    expect(resolveModel('legacy/gpt-5.5', models)).toBeUndefined()
    expect(resolveModel('gpt-5.5', models)?.provider).toBe('openai-codex')
    expect(resolveModel('', models, { provider: 'xai', model: 'grok-4.7' })?.id).toBe('grok-4.7')
    expect(resolveModel('', models)?.id).toBe('claude-sonnet-5')
    expect(resolveModel('nope', models)).toBeUndefined()
  })

  test('migrates retired runner model names to Pi providers', () => {
    expect(migrateModelName('claude', 'claude-opus-5')).toBe('anthropic/claude-opus-5')
    expect(migrateModelName('codex', 'gpt-5.5')).toBe('openai-codex/gpt-5.5')
    expect(migrateModelName('my-cli', 'm')).toBe('m')
    expect(migrateModelName('claude', '')).toBe('')
    expect(migrateModelName('claude', 'anthropic/x')).toBe('anthropic/x')
  })

  test('finds a context window for a qualified model', () => {
    expect(contextWindowFor('anthropic/claude-sonnet-5')).toBe(1_000_000)
    expect(contextWindowFor('claude-sonnet-5')).toBe(1_000_000)
  })
})

describe('migrateAgentsToPi', () => {
  test('moves every non-Pi agent onto Pi, keeping its model', async () => {
    const agents = [
      { id: 'a', runner: 'claude', model: 'claude-opus-5' },
      { id: 'b', runner: 'pi', model: 'xai/grok-4.7' },
      { id: 'c', runner: 'codex', model: 'gpt-5.5' },
    ] as Agent[]
    const update = vi.fn(async (id: string) => agents.find((a) => a.id === id)!)

    const changed = await migrateAgentsToPi({ findAll: () => agents, update })

    expect(changed).toEqual(['a', 'c'])
    expect(update).toHaveBeenCalledWith('a', { runner: 'pi', model: 'anthropic/claude-opus-5' })
    expect(update).toHaveBeenCalledWith('c', { runner: 'pi', model: 'openai-codex/gpt-5.5' })
  })
})

describe('toPiTool', () => {
  const definition = (handler: BuiltinToolDefinition['handler']): BuiltinToolDefinition => ({
    server: 'roster',
    name: 'open_session',
    description: 'Hand work on',
    inputSchema: { title: z.string() },
    handler,
  })

  test('exposes JSON Schema parameters and calls the handler with parsed args', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'opened' }] }))
    const tool = toPiTool(definition(handler as never))

    expect(tool.parameters).toMatchObject({ type: 'object', properties: { title: { type: 'string' } } })
    expect(tool.parameters).not.toHaveProperty('$schema')
    await expect(tool.execute('id', { title: 'x' })).resolves.toEqual({
      content: [{ type: 'text', text: 'opened' }],
      details: {},
    })
    expect(handler).toHaveBeenCalledWith({ title: 'x' }, {})
  })

  test('rejects invalid arguments and handler errors', async () => {
    const failing = toPiTool(
      definition((async () => ({ content: [{ type: 'text', text: 'no such agent' }], isError: true })) as never),
    )
    await expect(failing.execute('id', {})).rejects.toThrow(/invalid arguments/)
    await expect(failing.execute('id', { title: 'x' })).rejects.toThrow('no such agent')
  })
})

describe('EventQueue', () => {
  test('yields pushed items in order, waiting when empty, until closed', async () => {
    const queue = new EventQueue<number>()
    queue.push(1)
    const seen: number[] = []
    const consumer = (async () => {
      for await (const item of queue) seen.push(item)
    })()
    await Promise.resolve()
    queue.push(2)
    queue.close()
    queue.push(3)
    await consumer
    expect(seen).toEqual([1, 2])
  })
})

describe('PiRunner approvals', () => {
  test('ignores an answer to an approval it is not waiting on', () => {
    const runner = new PiRunner()
    expect(() => runner.respondToApproval('nope', { approved: true })).not.toThrow()
  })

  test('fails a turn whose working directory is missing', async () => {
    const runner = new PiRunner()
    const events = []
    for await (const event of runner.run('hi', {
      cwd: '/definitely/not/here',
      model: '',
      systemPrompt: '',
      skills: [],
      mcpServers: {},
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }
    expect(events[0]).toMatchObject({ kind: 'error' })
    expect(events.at(-1)).toEqual({ kind: 'done', runnerSessionId: '' })
  })
})
