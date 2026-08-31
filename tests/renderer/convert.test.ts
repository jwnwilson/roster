import { describe, expect, test } from 'vitest'
import type { Message } from '@shared/types'
import { headerFor, messageFromDataPart, toThreadMessage } from '@/chat/convert'

const AT = 1_800_000_000_000

/** The content union is readonly and wide; tests only need the shape. */
function firstPart(message: { content: unknown }): [Record<string, unknown>] {
  return [(message.content as Record<string, unknown>[])[0] as Record<string, unknown>]
}

const TEXT: Message = {
  id: 'm1',
  sessionId: 's1',
  kind: 'text',
  createdAt: AT,
  role: 'assistant',
  who: 'Debugging Agent',
  text: 'Reproduced the leak.',
}

const TOOL: Message = {
  id: 't1',
  sessionId: 's1',
  kind: 'tool',
  createdAt: AT,
  tool: 'run_command',
  args: 'pytest -k leak',
  output: '1 passed',
  isError: false,
  durationMs: 8_400,
}

const SPAWN: Message = {
  id: 'sp1',
  sessionId: 's1',
  kind: 'spawn',
  createdAt: AT,
  from: 'Architect Agent',
  text: 'Reproduce the leak.',
  to: { agentId: 'architect', sessionId: 'a1', label: 'Architect Agent · ADR-014' },
}

const HANDOFF: Message = {
  id: 'h1',
  sessionId: 's1',
  kind: 'handoff',
  createdAt: AT,
  links: [{ agentId: 'review', sessionId: 'r1', label: 'Review Agent · PR', status: 'done' }],
}

describe('toThreadMessage — text', () => {
  test('keeps the role, so user and agent turns render differently', () => {
    expect(toThreadMessage(TEXT).role).toBe('assistant')
    expect(toThreadMessage({ ...TEXT, role: 'user' } as Message).role).toBe('user')
  })

  test('carries the body as a text part', () => {
    expect(toThreadMessage(TEXT).content).toEqual([
      { type: 'text', text: 'Reproduced the leak.' },
    ])
  })

  test('preserves the id, so React keys and expansion state stay stable', () => {
    expect(toThreadMessage(TEXT).id).toBe('m1')
  })
})

describe('toThreadMessage — tool call', () => {
  test('maps onto assistant-ui’s own tool-call part', () => {
    const [part] = firstPart(toThreadMessage(TOOL))

    expect(part).toMatchObject({
      type: 'tool-call',
      toolCallId: 't1',
      toolName: 'run_command',
      argsText: 'pytest -k leak',
      result: '1 passed',
      isError: false,
    })
  })

  test('omits the result while the tool is still running', () => {
    const [part] = firstPart(toThreadMessage({ ...TOOL, output: '' } as Message))

    // Otherwise assistant-ui shows an empty result rather than a pending call.
    expect(part).not.toHaveProperty('result')
  })

  test('carries the duration through metadata, which parts cannot hold', () => {
    const meta = toThreadMessage(TOOL).metadata?.custom as { durationMs?: number }
    expect(meta.durationMs).toBe(8_400)
  })
})

describe('toThreadMessage — Roster’s own kinds', () => {
  test('spawn becomes a data part rather than a faked tool call', () => {
    const [part] = firstPart(toThreadMessage(SPAWN))

    expect(part.type).toBe('data-spawn')
    expect(part.data).toBe(SPAWN)
  })

  test('handoff becomes a data part', () => {
    const [part] = firstPart(toThreadMessage(HANDOFF))

    expect(part.type).toBe('data-handoff')
    expect(part.data).toBe(HANDOFF)
  })

  test('both are assistant-role, so they sit on the agent side', () => {
    expect(toThreadMessage(SPAWN).role).toBe('assistant')
    expect(toThreadMessage(HANDOFF).role).toBe('assistant')
  })
})

describe('headerFor', () => {
  test('a user message is labelled as the user', () => {
    expect(headerFor({ ...TEXT, role: 'user', who: 'you' } as Message)).toEqual({
      who: 'you',
      time: AT,
      isUser: true,
    })
  })

  test('an agent message is labelled with the agent name', () => {
    expect(headerFor(TEXT)).toMatchObject({ who: 'Debugging Agent', isUser: false })
  })

  test('a tool call is labelled as one', () => {
    expect(headerFor(TOOL)).toMatchObject({ who: 'tool call' })
  })

  test('a spawn names who opened the session', () => {
    expect(headerFor(SPAWN)).toMatchObject({ who: 'session opened by Architect Agent' })
  })

  test('a handoff is labelled as opened sessions', () => {
    expect(headerFor(HANDOFF)).toMatchObject({ who: 'opened sessions' })
  })

  test('every kind carries its own timestamp', () => {
    for (const message of [TEXT, TOOL, SPAWN, HANDOFF]) {
      expect(headerFor(message).time).toBe(AT)
    }
  })
})

describe('toThreadMessage — every kind', () => {
  test('preserves ids, so a transcript keeps its order and keys', () => {
    expect([TEXT, TOOL, SPAWN, HANDOFF].map((m) => toThreadMessage(m).id)).toEqual([
      'm1',
      't1',
      'sp1',
      'h1',
    ])
  })

  test('every kind carries a header', () => {
    for (const message of [TEXT, TOOL, SPAWN, HANDOFF]) {
      expect(toThreadMessage(message).metadata?.custom).toHaveProperty('header')
    }
  })
})

describe('messageFromDataPart', () => {
  test('recovers the Roster message from a spawn part', () => {
    expect(messageFromDataPart({ type: 'data-spawn', data: SPAWN })).toBe(SPAWN)
  })

  test('recovers it from a handoff part', () => {
    expect(messageFromDataPart({ type: 'data-handoff', data: HANDOFF })).toBe(HANDOFF)
  })

  test('returns nothing for a part that is not Roster’s', () => {
    expect(messageFromDataPart({ type: 'text' })).toBeNull()
  })

  test('returns nothing when the part carries no payload', () => {
    expect(messageFromDataPart({ type: 'data-spawn' })).toBeNull()
  })
})

describe('toThreadMessage — a tool row carrying a plan', () => {
  test('passes the plan id through, so the row can link to it', () => {
    const converted = toThreadMessage({
      id: 'm1',
      sessionId: 's1',
      kind: 'tool',
      tool: 'ExitPlanMode',
      args: '# Archive projects',
      input: '{"plan":"# Archive projects"}',
      planId: 'plan-1',
      output: 'ok',
      isError: false,
      createdAt: 0,
    })

    expect((converted.metadata?.custom as { planId?: string } | undefined)?.planId).toBe('plan-1')
  })
})
