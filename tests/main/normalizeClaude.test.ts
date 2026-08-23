import { describe, expect, test } from 'vitest'
import { normalizeClaudeMessage, summariseArgs } from '@main/runners/normalizeClaude'
import type { RunnerEvent } from '@main/runners/types'
import {
  ASSISTANT_TEXT,
  FULL_TURN,
  RATE_LIMIT_EVENT,
  RESULT_ERROR,
  RESULT_SUCCESS,
  SYSTEM_INIT,
  THINKING_ONLY,
  TOOL_RESULT,
  TOOL_RESULT_ERROR,
  TOOL_USE,
  ASSISTANT_TEXT_DUPLICATE,
  STREAMED_TURN,
  STREAM_BLOCK_STOP,
  STREAM_MESSAGE_START,
  STREAM_SIGNATURE_DELTA,
  STREAM_TEXT_DELTA,
  STREAM_TEXT_DELTA_2,
  STREAM_THINKING_DELTA,
} from './fixtures/claude-stream'

function normalizeAll(messages: unknown[], streaming = false): RunnerEvent[] {
  // Not point-free: flatMap would pass the index as the options argument.
  return messages.flatMap((message) => normalizeClaudeMessage(message, { streaming }))
}

describe('normalizeClaudeMessage — messages Roster ignores', () => {
  test.each([
    ['system init', SYSTEM_INIT],
    ['rate limit event', RATE_LIMIT_EVENT],
    ['thinking-only assistant turn', THINKING_ONLY],
  ])('yields nothing for a %s', (_label, message) => {
    expect(normalizeClaudeMessage(message)).toEqual([])
  })

  test('ignores an unknown message type rather than throwing', () => {
    // The SDK's union grows between releases; unknown kinds must be inert.
    expect(normalizeClaudeMessage({ type: 'some_future_event', payload: 1 })).toEqual([])
  })

  test.each([[null], [undefined], ['a string'], [42], [[]]])(
    'ignores the malformed value %s',
    (value) => {
      expect(normalizeClaudeMessage(value)).toEqual([])
    },
  )
})

describe('normalizeClaudeMessage — assistant turns', () => {
  test('emits prose as a text delta', () => {
    expect(normalizeClaudeMessage(ASSISTANT_TEXT)).toEqual([
      { kind: 'text', delta: 'hello from roster fixture' },
    ])
  })

  test('emits a tool call with its id and name', () => {
    expect(normalizeClaudeMessage(TOOL_USE)).toEqual([
      { kind: 'tool', id: 'toolu_016Mdj', name: 'Read', args: '/work/api/note.txt' },
    ])
  })

  test('drops empty text deltas', () => {
    const message = { type: 'assistant', message: { content: [{ type: 'text', text: '' }] } }
    expect(normalizeClaudeMessage(message)).toEqual([])
  })

  test('emits several events when one turn carries several blocks', () => {
    const message = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Reading it now.' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a' } },
        ],
      },
    }

    expect(normalizeClaudeMessage(message)).toHaveLength(2)
  })

  test('skips a tool_use block missing its id', () => {
    const message = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] },
    }
    expect(normalizeClaudeMessage(message)).toEqual([])
  })
})

describe('normalizeClaudeMessage — tool results', () => {
  test('pairs a string result back to its call', () => {
    expect(normalizeClaudeMessage(TOOL_RESULT)).toEqual([
      {
        kind: 'result',
        id: 'toolu_016Mdj',
        output: '1\thello from roster fixture\n2\t',
        isError: false,
      },
    ])
  })

  test('flattens block-array content and preserves the error flag', () => {
    expect(normalizeClaudeMessage(TOOL_RESULT_ERROR)).toEqual([
      { kind: 'result', id: 'toolu_016Mdj', output: 'ENOENT: no such file', isError: true },
    ])
  })

  test('ignores an ordinary user message with no tool result', () => {
    const message = { type: 'user', message: { content: [{ type: 'text', text: 'hi' }] } }
    expect(normalizeClaudeMessage(message)).toEqual([])
  })
})

describe('normalizeClaudeMessage — result', () => {
  test('reports usage and ends the turn with the CLI session id', () => {
    expect(normalizeClaudeMessage(RESULT_SUCCESS)).toEqual([
      { kind: 'usage', inputTokens: 18, outputTokens: 297, costUsd: 0.0484788 },
      { kind: 'done', runnerSessionId: 'sess-abc' },
    ])
  })

  test('a failed run still ends the turn, so the UI cannot hang', () => {
    const events = normalizeClaudeMessage(RESULT_ERROR)

    expect(events.map((e) => e.kind)).toEqual(['usage', 'error', 'done'])
    expect(events.find((e) => e.kind === 'error')).toMatchObject({
      message: 'the model refused the request',
    })
  })

  test('falls back to the subtype when a failure carries no message', () => {
    const events = normalizeClaudeMessage({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      session_id: 's',
    })

    expect(events.find((e) => e.kind === 'error')).toMatchObject({
      message: 'run failed: error_max_turns',
    })
  })
})

describe('normalizeClaudeMessage — a whole recorded turn', () => {
  test('produces the sequence the chat pane renders', () => {
    expect(normalizeAll(FULL_TURN).map((e) => e.kind)).toEqual([
      'tool',
      'result',
      'text',
      'usage',
      'done',
    ])
  })

  test('every tool call in the turn is matched by a result with the same id', () => {
    const events = normalizeAll(FULL_TURN)
    const calls = events.filter((e) => e.kind === 'tool').map((e) => e.id)
    const results = events.filter((e) => e.kind === 'result').map((e) => e.id)

    expect(results).toEqual(calls)
  })
})

describe('summariseArgs', () => {
  test.each([
    [{ command: 'pytest -k leak' }, 'pytest -k leak'],
    [{ file_path: '/work/api/pool.ts' }, '/work/api/pool.ts'],
    [{ pattern: 'def handle_' }, 'def handle_'],
    ['already a string', 'already a string'],
  ])('summarises %o as its most telling field', (input, expected) => {
    expect(summariseArgs(input)).toBe(expected)
  })

  test('falls back to compact JSON when no field stands out', () => {
    expect(summariseArgs({ a: 1, b: 2 })).toBe('{"a":1,"b":2}')
  })

  test('returns empty for nothing at all', () => {
    expect(summariseArgs(undefined)).toBe('')
    expect(summariseArgs(null)).toBe('')
  })

  test('never returns a multi-line string, since the row is one line', () => {
    // A Write tool call carries the whole file body in `content`.
    const summary = summariseArgs({ content: 'line one\nline two', file_path: '/a.txt' })
    expect(summary).not.toContain('\n')
  })
})


describe('normalizeClaudeMessage — streaming', () => {
  const streaming = { streaming: true }

  test('emits each text delta as it arrives', () => {
    expect(normalizeClaudeMessage(STREAM_TEXT_DELTA, streaming)).toEqual([
      { kind: 'text', delta: 'ONE ' },
    ])
  })

  test('ignores stream events entirely when not streaming', () => {
    // Otherwise a stray partial message would double the text.
    expect(normalizeClaudeMessage(STREAM_TEXT_DELTA)).toEqual([])
  })

  test('ignores thinking and signature deltas, which the design never shows', () => {
    expect(normalizeClaudeMessage(STREAM_THINKING_DELTA, streaming)).toEqual([])
    expect(normalizeClaudeMessage(STREAM_SIGNATURE_DELTA, streaming)).toEqual([])
  })

  test('ignores the stream lifecycle events', () => {
    expect(normalizeClaudeMessage(STREAM_MESSAGE_START, streaming)).toEqual([])
    expect(normalizeClaudeMessage(STREAM_BLOCK_STOP, streaming)).toEqual([])
  })

  test('skips text on the complete message, which the deltas already delivered', () => {
    // This is the whole reason streaming is an explicit mode: the SDK sends
    // both, and reading both prints every reply twice.
    expect(normalizeClaudeMessage(ASSISTANT_TEXT_DUPLICATE, streaming)).toEqual([])
  })

  test('still takes tool calls from the complete message', () => {
    // A half-parsed argument object is of no use, so tools are never streamed.
    expect(normalizeClaudeMessage(TOOL_USE, streaming)).toEqual([
      { kind: 'tool', id: 'toolu_016Mdj', name: 'Read', args: '/work/api/note.txt' },
    ])
  })

  test('a whole streamed turn yields each delta exactly once', () => {
    const events = normalizeAll(STREAMED_TURN, true)

    expect(events.map((e) => e.kind)).toEqual(['text', 'text', 'usage', 'done'])
    expect(
      events
        .filter((e) => e.kind === 'text')
        .map((e) => e.delta)
        .join(''),
    ).toBe('ONE TWO')
  })

  test('the same turn read without streaming yields the text once too', () => {
    // Whichever mode is used, the reply must appear exactly once.
    const events = normalizeAll(STREAMED_TURN, false)

    expect(events.filter((e) => e.kind === 'text').map((e) => e.delta)).toEqual(['ONE TWO'])
  })
})
