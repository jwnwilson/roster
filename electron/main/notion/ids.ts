/**
 * Notion page ids out of whatever someone pasted.
 *
 * People paste a URL far more often than an id, and Notion writes ids both
 * with and without dashes. Everything is kept in the plain 32-character form
 * so one page is one string, whichever link it arrived in.
 */

const BARE_ID = /[0-9a-f]{32}/gi
const DASHED_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export function notionPageIdFrom(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null

  // A page opened from inside a database view carries the database id in the
  // path and the page's own id in `p`, so the query parameter wins where it
  // exists — the last id in the URL would be the wrong one.
  const peeked = peekedPageId(trimmed)
  if (peeked) return peeked

  const bare = trimmed.match(BARE_ID)
  if (bare && bare.length > 0) return (bare[bare.length - 1] as string).toLowerCase()

  const dashed = trimmed.match(DASHED_ID)
  return dashed ? dashed[0].toLowerCase().replaceAll('-', '') : null
}

/**
 * The link Roster stores and offers to open.
 *
 * Always rebuilt from the id rather than kept as pasted: a task description
 * is rendered as markdown and its links open in the user's browser, so the
 * only address that ever gets there is one Roster composed itself.
 */
export function notionPageUrl(pageId: string): string {
  return `https://www.notion.so/${pageId}`
}

function peekedPageId(input: string): string | null {
  const start = input.indexOf('?')
  if (start === -1) return null
  const value = new URLSearchParams(input.slice(start + 1)).get('p')
  if (!value) return null
  const match = value.match(BARE_ID)
  return match && match.length > 0 ? (match[0] as string).toLowerCase() : null
}
