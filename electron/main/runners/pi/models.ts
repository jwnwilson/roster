import type { ModelInfo } from '../../../../shared/types'

/** The fields of a Pi model Roster reads. */
export interface PiModelLike {
  provider: string
  id: string
  name?: string
  contextWindow?: number
  cost?: { input?: number; output?: number }
}

/** A model as Roster names it: `provider/id`, so two providers' ids cannot collide. */
export function modelKey(model: Pick<PiModelLike, 'provider' | 'id'>): string {
  return `${model.provider}/${model.id}`
}

/** "$3 / $15" per million tokens, or empty when Pi has no figure. */
export function priceLabel(model: PiModelLike): string {
  const input = model.cost?.input
  const output = model.cost?.output
  if (input === undefined || output === undefined || (input === 0 && output === 0)) return ''
  return `$${trim(input)} / $${trim(output)}`
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)))
}

/**
 * Every model, signed-in providers first, each saying whether it can run now.
 *
 * `signedIn` names the providers with credentials; omitted, every model is
 * treated as signed in. `providerName` gives the display name for grouping.
 */
export function toModelInfo(
  models: readonly PiModelLike[],
  signedIn?: ReadonlySet<string>,
  providerName: (provider: string) => string | undefined = () => undefined,
): ModelInfo[] {
  const info = models.map((model): ModelInfo => {
    const name = providerName(model.provider)
    return {
      id: modelKey(model),
      price: priceLabel(model),
      ...(signedIn === undefined || signedIn.has(model.provider) ? {} : { signedIn: false }),
      ...(name !== undefined ? { provider: name } : {}),
    }
  })
  // Stable: within each half the catalogue's own order is kept.
  return [...info.filter((m) => m.signedIn !== false), ...info.filter((m) => m.signedIn === false)]
}

/**
 * The model an agent names, among the ones Pi can actually use.
 *
 * Accepts `provider/id` — what Roster writes — and also a bare id, which is
 * what agents written for the Claude or Codex runners carry. A blank name
 * means "whatever Pi would pick": the preferred default when it is usable,
 * else the first usable model.
 */
export function resolveModel<M extends PiModelLike>(
  name: string,
  available: readonly M[],
  preferred?: { provider?: string; model?: string },
): M | undefined {
  const wanted = name.trim()

  if (wanted === '') {
    const fallback = available.find(
      (model) => model.provider === preferred?.provider && model.id === preferred?.model,
    )
    return fallback ?? available[0]
  }

  const exact = available.find((model) => modelKey(model) === wanted)
  if (exact) return exact

  const slash = wanted.indexOf('/')
  const bare = slash === -1 ? wanted : wanted.slice(slash + 1)
  return available.find((model) => model.id === bare)
}

/**
 * Rewrites a model named for a retired runner into Pi's `provider/id`.
 *
 * Used when migrating agents: Claude ids go to Anthropic and Codex ids to
 * OpenAI's Codex provider. Anything already qualified, or blank, is kept.
 */
export function migrateModelName(runner: string, model: string): string {
  if (model === '' || model.includes('/')) return model
  if (runner === 'claude') return `anthropic/${model}`
  if (runner === 'codex') return `openai-codex/${model}`
  return model
}
