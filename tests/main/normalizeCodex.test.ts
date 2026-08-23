import { describe, expect, test } from 'vitest'
import { normalizeCodexMessage } from '@main/runners/normalizeCodex'
import { composePrompt } from '@main/runners/codex'
import type { RunnerEvent } from '@main/runners/types'
import {
  FULL_TURN,
  ITEM_AGENT_MESSAGE_1,
  ITEM_COMMAND_COMPLETED,
  ITEM_COMMAND_STARTED,
  THREAD_STARTED,
  TURN_COMPLETED,
  TURN_FAILED,
  TURN_STARTED,
} from './fixtures/codex-stream'

function normalizeAll(messages: unknown[]): RunnerEvent[] {
  return messages.flatMap(normalizeCodexMessage)
}

describe('normalizeCodexMessage — session identity', () => {
  test('reports the thread id as the runner session, for resume', () => {
    expect(normalizeCodexMessage(THREAD_STARTED)).toEqual([
      { kind: 'session', runnerSessionId: '01a0302c-17f1-7a41-9ae6-bd1f24f5abfa' },
    ])
  })

  test('the thread id arrives before any content, unlike Claude', () => {
    // Codex opens with it; Claude only reports its session on the result.
    const events = normalizeAll(FULL_TURN)
    expect(events[0]).toMatchObject({ kind: 'session' })
  })
})

describe('normalizeCodexMessage — messages Roster ignores', () => {
  test('yields nothing for turn.started', () => {
    expect(normalizeCodexMessage(TURN_STARTED)).toEqual([])
  })

  test('ignores an unknown event type rather than throwing', () => {
    expect(normalizeCodexMessage({ type: 'some.future.event' })).toEqual([])
  })

  test.each([[null], [undefined], ['a string'], [42], [[]]])(
    'ignores the malformed value %s',
    (value) => {
      expect(normalizeCodexMessage(value)).toEqual([])
    },
  )

  test('ignores an item with no id', () => {
    const message = { type: 'item.completed', item: { type: 'agent_message', text: 'hi' } }
    expect(normalizeCodexMessage(message)).toEqual([])
  })
})

describe('normalizeCodexMessage — agent messages', () => {
  test('emits completed prose as a text delta', () => {
    expect(normalizeCodexMessage(ITEM_AGENT_MESSAGE_1)).toEqual([
      { kind: 'text', delta: 'Running the requested command.' },
    ])
  })

  test('ignores a started agent message, which carries no text yet', () => {
    const started = { type: 'item.started', item: { id: 'x', type: 'agent_message', text: '' } }
    expect(normalizeCodexMessage(started)).toEqual([])
  })
})

describe('normalizeCodexMessage — command execution', () => {
  test('opens a tool row when the command starts', () => {
    expect(normalizeCodexMessage(ITEM_COMMAND_STARTED)).toEqual([
      { kind: 'tool', id: 'item_1', name: 'shell', args: "/bin/zsh -lc 'echo codex-tool-ok'" },
    ])
  })

  test('closes it with the aggregated output when it completes', () => {
    expect(normalizeCodexMessage(ITEM_COMMAND_COMPLETED)).toEqual([
      { kind: 'result', id: 'item_1', output: 'codex-tool-ok\n', isError: false },
    ])
  })

  test('marks a non-zero exit as an error', () => {
    const failed = {
      type: 'item.completed',
      item: {
        id: 'item_9',
        type: 'command_execution',
        aggregated_output: 'command not found',
        exit_code: 127,
      },
    }

    expect(normalizeCodexMessage(failed)).toEqual([
      { kind: 'result', id: 'item_9', output: 'command not found', isError: true },
    ])
  })

  test('pairs the result to the call by id', () => {
    const events = normalizeAll(FULL_TURN)
    const call = events.find((e) => e.kind === 'tool')
    const result = events.find((e) => e.kind === 'result')

    expect(result?.kind === 'result' && call?.kind === 'tool' && result.id === call.id).toBe(true)
  })
})

describe('normalizeCodexMessage — turn completion', () => {
  test('reports usage and ends the turn', () => {
    expect(normalizeCodexMessage(TURN_COMPLETED)).toEqual([
      { kind: 'usage', inputTokens: 29_223, outputTokens: 121, costUsd: 0 },
      { kind: 'done', runnerSessionId: '' },
    ])
  })

  test('a failed turn still ends, so the UI cannot hang', () => {
    const events = normalizeCodexMessage(TURN_FAILED)

    expect(events.map((e) => e.kind)).toEqual(['error', 'done'])
    expect(events[0]).toMatchObject({ message: 'model refused the request' })
  })
})

describe('normalizeCodexMessage — a whole recorded turn', () => {
  test('produces the sequence the chat pane renders', () => {
    expect(normalizeAll(FULL_TURN).map((e) => e.kind)).toEqual([
      'session',
      'text',
      'tool',
      'result',
      'text',
      'usage',
      'done',
    ])
  })
})

describe('composePrompt', () => {
  test('prepends the agent house rules, since codex exec has no system flag', () => {
    expect(composePrompt('Fix the leak.', 'Reproduce before you fix.')).toBe(
      'Reproduce before you fix.\n\n---\n\nFix the leak.',
    )
  })

  test('passes the prompt through untouched when there are no house rules', () => {
    expect(composePrompt('Fix the leak.', '')).toBe('Fix the leak.')
    expect(composePrompt('Fix the leak.', '   ')).toBe('Fix the leak.')
  })
})
