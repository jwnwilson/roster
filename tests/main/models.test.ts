import { describe, expect, test } from 'vitest'
import { contextFraction, contextLabel, contextWindowFor } from '@shared/models'

describe('contextWindowFor', () => {
  test('knows the models Roster ships with', () => {
    expect(contextWindowFor('claude-opus-5')).toBe(1_000_000)
    expect(contextWindowFor('claude-haiku-4-5')).toBe(200_000)
  })

  test('reports nothing for an unknown model rather than guessing', () => {
    // Codex offers whatever slugs are in the user's models_cache.json, so
    // this is the common case there, not an edge case.
    expect(contextWindowFor('some-future-model')).toBeNull()
  })
})

describe('contextFraction', () => {
  test('reports how full the window is', () => {
    expect(contextFraction('claude-opus-5', 250_000)).toBeCloseTo(0.25)
  })

  test('a fresh session is empty, not unknown', () => {
    expect(contextFraction('claude-opus-5', 0)).toBe(0)
  })

  test('never exceeds a full window', () => {
    // A CLI can report tokens Roster's table does not account for.
    expect(contextFraction('claude-haiku-4-5', 9_000_000)).toBe(1)
  })

  test('null for an unknown model, which is not the same as empty', () => {
    // The distinction the bar depends on: 0 draws an empty bar that reads as
    // "plenty of room", which Roster cannot claim about a model it cannot size.
    expect(contextFraction('some-future-model', 100)).toBeNull()
    expect(contextFraction('claude-opus-5', 0)).toBe(0)
  })

  test('treats a negative count as empty rather than going below zero', () => {
    expect(contextFraction('claude-opus-5', -50)).toBe(0)
  })
})

describe('contextLabel', () => {
  test('reads as a whole percentage', () => {
    expect(contextLabel(0.58)).toBe('58%')
  })

  test('a session that has not started is flatly zero', () => {
    expect(contextLabel(0)).toBe('0%')
  })

  test('distinguishes barely-used from untouched', () => {
    // 10 tokens of a 1M window rounds to 0%, which would read identically
    // to a session that has never run.
    expect(contextLabel(0.00001)).toBe('<1%')
    expect(contextLabel(0.004)).toBe('<1%')
  })

  test('rounds normally once past half a percent', () => {
    expect(contextLabel(0.006)).toBe('1%')
  })

  test('a full window reads as 100%', () => {
    expect(contextLabel(1)).toBe('100%')
  })
})
