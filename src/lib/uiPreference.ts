/**
 * Choices about how Roster looks, kept between runs.
 *
 * Chrome rather than data: how wide a modal opens says nothing about the
 * roster, so it stays in the renderer instead of earning a table, an IPC
 * channel and a migration. Everything Roster actually owns still lives in
 * `~/roster`.
 */

/**
 * A remembered flag, or the fallback.
 *
 * Storage is untrusted — hand-edited, cleared, or refused outright when the
 * origin is opaque — so anything that is not exactly a stored flag becomes
 * the fallback. Forgetting a preference is a smaller loss than a screen that
 * will not open.
 */
export function readFlag(key: string, fallback: boolean): boolean {
  let stored: string | null
  try {
    stored = window.localStorage.getItem(key)
  } catch {
    return fallback
  }

  if (stored === 'true') return true
  if (stored === 'false') return false
  return fallback
}

/** Writes a flag back, or forgets it if storage will not take it. */
export function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // Nothing to tell the user: the choice still holds for this run, and it
    // is the next run that will have forgotten it.
  }
}
