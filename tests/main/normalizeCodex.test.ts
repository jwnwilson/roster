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
      {
        kind: 'usage',
        inputTokens: 29_223,
        cachedInputTokens: 24_064,
        outputTokens: 121,
        totalTokens: 29_344,
        costUsd: 0,
      },
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

describe('composePrompt — skills, which Codex has no mechanism for', () => {
  function aSkill(name: string, body: string) {
    return { name, path: `/skills/${name}`, body }
  }

  test('inlines an enabled skill, since codex exec cannot load one', () => {
    const prompt = composePrompt('Fix the leak.', '', [
      aSkill('repro-harness', '# Repro Harness\n\nWrite the failing test first.'),
    ])

    expect(prompt).toContain('Write the failing test first.')
    expect(prompt).toContain('repro-harness')
  })

  test('says the block is a skill, so it does not read as the user talking', () => {
    const prompt = composePrompt('Fix the leak.', '', [aSkill('repro-harness', '# R')])

    expect(prompt).toMatch(/skills available to you/i)
  })

  test('keeps the user’s own prompt last, where the model expects the ask', () => {
    const prompt = composePrompt('Fix the leak.', 'House rules.', [aSkill('a', '# A')])

    expect(prompt.endsWith('Fix the leak.')).toBe(true)
  })

  test('changes nothing when the agent has no skills', () => {
    expect(composePrompt('Fix the leak.', '', [])).toBe('Fix the leak.')
  })

  test('names a skill it cannot afford to inline rather than cutting it in half', () => {
    // Half a skill is worse than a pointer to one: the steps that got cut are
    // the ones the model would have followed.
    const big = aSkill('huge', 'x'.repeat(20_000))
    const small = aSkill('small', '# Small\n\nShort and useful.')

    const prompt = composePrompt('Go.', '', [big, small])

    expect(prompt).toContain('huge')
    expect(prompt).not.toContain('x'.repeat(20_000))
  })

  test('spends the budget in order, so the first skills listed are the ones inlined', () => {
    const small = aSkill('small', '# Small\n\nShort and useful.')
    const big = aSkill('huge', 'x'.repeat(20_000))

    const prompt = composePrompt('Go.', '', [small, big])

    expect(prompt).toContain('Short and useful.')
  })
})

describe('normalizeCodexMessage — token totals', () => {
  test('does not add cached tokens, which Codex counts inside input', () => {
    // 29,223 input already contains the 24,064 cache hits. Adding them —
    // which is right for Claude — would report 53,408 for a 29,344 turn.
    const [usage] = normalizeCodexMessage(TURN_COMPLETED)

    expect(usage).toMatchObject({ totalTokens: 29_344 })
  })

  test('keeps cached input separate for the API-equivalent estimate', () => {
    const [usage] = normalizeCodexMessage(TURN_COMPLETED)

    expect(usage).toMatchObject({ cachedInputTokens: 24_064 })
  })

  test('does not add reasoning tokens to output, because Codex already includes them', () => {
    const [usage] = normalizeCodexMessage({
      type: 'turn.completed',
      usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 25, reasoning_output_tokens: 20 },
    })

    expect(usage).toMatchObject({ outputTokens: 25, totalTokens: 35 })
  })
})
