import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { rosterHome } from '../../store/paths'

/**
 * Models a signed-in account has been refused, so the picker can grey them
 * out instead of letting you pick one only to fail on the first turn.
 *
 * A provider's catalogue lists every model it serves, but an account may
 * only reach some — a ChatGPT plan through Codex is the case that prompted
 * this. Roster learns it two ways: a turn that fails with "not supported for
 * your account" records it, and checking a provider's models probes them.
 * Signing a provider in again forgets what was learnt, since the account
 * behind it may have changed.
 */

export interface Unavailable {
  /** The provider's own words, shown on hover. */
  reason: string
  checkedAt: number
}

type Store = Record<string, Unavailable>

export function availabilityPath(): string {
  return join(rosterHome(), 'pi-model-availability.json')
}

function read(): Store {
  try {
    const parsed = JSON.parse(readFileSync(availabilityPath(), 'utf8')) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

function write(store: Store): void {
  mkdirSync(dirname(availabilityPath()), { recursive: true })
  writeFileSync(availabilityPath(), `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

/** Every model known to be refused, keyed `provider/id`. */
export function unavailableModels(): Store {
  return read()
}

export function markUnavailable(key: string, reason: string, now = Date.now()): void {
  write({ ...read(), [key]: { reason, checkedAt: now } })
}

export function markAvailable(key: string): void {
  const store = read()
  if (!(key in store)) return
  const { [key]: _gone, ...rest } = store
  write(rest)
}

/** Forgets everything learnt about one provider's models. */
export function forgetProvider(provider: string): void {
  const store = read()
  const kept = Object.fromEntries(
    Object.entries(store).filter(([key]) => !key.startsWith(`${provider}/`)),
  )
  if (Object.keys(kept).length !== Object.keys(store).length) write(kept)
}

/**
 * Whether a failure says this account cannot use this model — as opposed to
 * the request failing for a reason that would pass on a retry.
 */
export function isModelUnavailable(message: string): boolean {
  return /not supported when using|not available (on|for) your (plan|account)|do(es)? not have access to (the )?model|model[^.]{0,80}(does not exist|not found|is not available)|unsupported model/i.test(
    message,
  )
}
