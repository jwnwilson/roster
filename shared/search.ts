/**
 * How a transcript snippet marks the words that matched.
 *
 * Two private-use code points rather than HTML or brackets: a transcript can
 * contain any of those, and a snippet is rendered as text, so the marks must
 * be something no message is likely to hold. The store writes them; the
 * renderer splits on them.
 */
export const MATCH_OPEN = '\uE000'
export const MATCH_CLOSE = '\uE001'

export interface SnippetPart {
  text: string
  matched: boolean
}

/** A snippet as alternating plain and matched runs, in reading order. */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = []
  let matched = false
  let run = ''

  for (const char of snippet) {
    if (char === MATCH_OPEN || char === MATCH_CLOSE) {
      if (run !== '') parts.push({ text: run, matched })
      run = ''
      matched = char === MATCH_OPEN
      continue
    }
    run += char
  }

  if (run !== '') parts.push({ text: run, matched })
  return parts
}

/** The same markers as SQL literals, for the snippet() call in the store. */
export const MATCH_OPEN_SQL = 'char(57344)'
export const MATCH_CLOSE_SQL = 'char(57345)'
