/**
 * Naming a session — the rules the main process and the renderer both obey.
 *
 * A name is the one thing about a session a person writes, so it is the one
 * thing that needs validating. Both sides do it: the renderer so the box can
 * refuse a name before a round trip, the store because it is the boundary
 * that actually writes.
 */

/**
 * A name has to fit a session tab beside a status dot and an origin glyph.
 * Past this it is not a name any more, it is a note to self.
 */
export const SESSION_NAME_MAX_LENGTH = 60

/** What a session with neither name nor title is called. */
export const UNNAMED_SESSION_LABEL = 'Untitled session'

/**
 * The name as it will be stored: one line, trimmed, and short enough to
 * render. Null means unnamed — which is a legitimate state, not an error.
 * Naming is encouraged everywhere and required nowhere.
 */
export function normalizeSessionName(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null

  // Newlines and tabs arrive by paste. Collapsed rather than rejected: the
  // name is still the one that was meant, it just fits on the tab now.
  const flattened = input.replace(/\s+/g, ' ').trim()
  if (flattened === '') return null

  // Trimmed again, so a cut that lands on a space does not store one. The
  // result cannot be empty: flattened is trimmed, so it starts with a
  // character the cut always keeps.
  return flattened.slice(0, SESSION_NAME_MAX_LENGTH).trim()
}

/** What a session is called, wherever one is listed. */
export function sessionLabel(session: { name?: string | null; title: string }): string {
  const name = session.name?.trim()
  if (name !== undefined && name !== '') return name

  // Unnamed: the title stands in. For a handed-off session that says who
  // sent it and why, which is a better label than anything a fallback could
  // invent; for one you opened yourself it is "New session", which is the
  // nudge asking to be replaced.
  const title = session.title.trim()
  return title === '' ? UNNAMED_SESSION_LABEL : title
}

/** Whether the "Name this session" nudge still has something to ask for. */
export function isSessionNamed(session: { name?: string | null }): boolean {
  const name = session.name?.trim()
  return name !== undefined && name !== ''
}
