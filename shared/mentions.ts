/**
 * Reading `@agent-id` out of a comment.
 *
 * Shared because the composer completes mentions while the main process
 * resolves them, and those two must agree on what counts as one.
 */

export interface Mention {
  agentId: string
  /** Offsets into the source text, so a composer can replace the token. */
  start: number
  end: number
}

/**
 * An agent id is a slug — `AgentStore.slugify` lowercases and collapses
 * everything else to hyphens — so a mention is one word, and needs no greedy
 * matching against multi-word display names.
 *
 * The leading group is what keeps `noel@tech-lead` out: an `@` following a
 * word character belongs to something else. It excludes `@` as well, so the
 * second half of `@a@b` is not read as a mention of its own.
 */
const MENTION = /(^|[^\w@])@([a-zA-Z0-9][a-zA-Z0-9-]*)/g

export function parseMentions(text: string, knownAgentIds: readonly string[]): Mention[] {
  const known = new Set(knownAgentIds)
  const seen = new Set<string>()
  const found: Mention[] = []

  for (const match of text.matchAll(MENTION)) {
    const prefix = match[1] ?? ''
    const token = match[2] ?? ''
    const agentId = token.toLowerCase()

    // An id nobody has is ordinary text, and an agent named twice is asked
    // once.
    if (!known.has(agentId) || seen.has(agentId)) continue
    seen.add(agentId)

    const start = (match.index ?? 0) + prefix.length
    found.push({ agentId, start, end: start + 1 + token.length })
  }

  return found
}
