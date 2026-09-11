import { describe, expect, test } from 'vitest'
import { CODEX_RATE_TABLE_VERSION, estimateCodexCost } from '@main/costs/codex'

describe('Codex API-equivalent estimates', () => {
  test('prices uncached input, cached input, and output at the recorded model rate', () => {
    expect(
      estimateCodexCost({
        model: 'gpt-5.1-codex',
        inputTokens: 1_000_000,
        cachedInputTokens: 200_000,
        outputTokens: 1_000_000,
      }),
    ).toEqual({
      costType: 'estimated',
      costUsd: 11.025,
      model: 'gpt-5.1-codex',
      rateTableVersion: CODEX_RATE_TABLE_VERSION,
    })
  })

  test('treats missing cached input as zero and does not price reasoning twice', () => {
    expect(
      estimateCodexCost({ model: 'gpt-5.1-codex', inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toMatchObject({ costType: 'estimated', costUsd: 11.25 })
  })

  test('makes an unmapped model unavailable rather than inventing $0.00', () => {
    expect(
      estimateCodexCost({ model: 'gpt-99-codex', inputTokens: 10, outputTokens: 5 }),
    ).toEqual({ costType: 'unavailable', costUsd: 0, model: 'gpt-99-codex', rateTableVersion: null })
  })

  test('retains sub-cent estimates precisely for presentation to round later', () => {
    const estimate = estimateCodexCost({ model: 'gpt-5.1-codex', inputTokens: 0, outputTokens: 500 })

    expect(estimate.costUsd).toBe(0.005)
  })
})
