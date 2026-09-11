import type { CostType } from '../../../shared/types'

/** Bump this when changing a rate: completed rows retain their old version. */
export const CODEX_RATE_TABLE_VERSION = '2026-09-11'

interface ModelRate {
  input: number
  cachedInput: number
  output: number
}

// USD per million tokens. These are API rates, not ChatGPT subscription charges.
const RATES: Readonly<Record<string, ModelRate>> = {
  // These are the Codex runner's fallback choices. Keep this set in step with
  // FALLBACK_MODELS in runners/codex.ts; an offered fallback must either have
  // an explicit rate or be deliberately left unavailable.
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
  'gpt-5.5': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
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
  const rate = RATES[input.model] ?? RATES[modelAlias(input.model)]
  if (!rate) {
    return { costType: 'unavailable', costUsd: 0, model: input.model, rateTableVersion: null }
  }

  const cached = Math.max(0, Math.min(input.cachedInputTokens ?? 0, input.inputTokens))
  const costUsd =
    ((input.inputTokens - cached) * rate.input + cached * rate.cachedInput + input.outputTokens * rate.output) /
    1_000_000

  return { costType: 'estimated', costUsd, model: input.model, rateTableVersion: CODEX_RATE_TABLE_VERSION }
}

/**
 * OpenAI's dated snapshots use the same price as their canonical model slug.
 * Retain the original slug on the usage row while looking up its explicit
 * family rate; all other unknown models remain unavailable.
 */
function modelAlias(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '')
}
