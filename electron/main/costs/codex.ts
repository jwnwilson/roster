import type { CostType } from '../../../shared/types'

/** Bump this when changing a rate: completed rows retain their old version. */
export const CODEX_RATE_TABLE_VERSION = '2026-09-06'

interface ModelRate {
  input: number
  cachedInput: number
  output: number
}

// USD per million tokens. These are API rates, not ChatGPT subscription charges.
const RATES: Readonly<Record<string, ModelRate>> = {
  'gpt-5-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5.1-codex-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5.1-codex-max': { input: 1.25, cachedInput: 0.125, output: 10 },
}

export interface CodexCostInput {
  model: string
  inputTokens: number
  cachedInputTokens?: number
  outputTokens: number
}

export interface CodexCostEstimate {
  costType: CostType
  costUsd: number
  model: string
  rateTableVersion: string | null
}

export function estimateCodexCost(input: CodexCostInput): CodexCostEstimate {
  const rate = RATES[input.model]
  if (!rate) {
    return { costType: 'unavailable', costUsd: 0, model: input.model, rateTableVersion: null }
  }

  const cached = Math.max(0, Math.min(input.cachedInputTokens ?? 0, input.inputTokens))
  const costUsd =
    ((input.inputTokens - cached) * rate.input + cached * rate.cachedInput + input.outputTokens * rate.output) /
    1_000_000

  return { costType: 'estimated', costUsd, model: input.model, rateTableVersion: CODEX_RATE_TABLE_VERSION }
}
