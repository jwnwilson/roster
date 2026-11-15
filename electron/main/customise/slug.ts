/**
 * What a user may name a customised copy, and how that name becomes a branch.
 *
 * The name is for people; the branch and the folder are for git and the disk,
 * so only the slug reaches them. The fork URL is checked here too, because a
 * `file://` or a bare word would otherwise be handed to `git remote add`.
 */

export const MAX_NAME_LENGTH = 60

export function validateName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('Give your copy a name.')
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`Keep the copy name under ${MAX_NAME_LENGTH} characters.`)
  }
  return trimmed
}

/** `customise/<slug>`: the branch a copy's changes are made on. */
export function branchNameFor(name: string): string {
  const slug = validateName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug === '') throw new Error('Give your copy a name with letters or numbers in it.')
  return `customise/${slug}`
}

/**
 * An optional fork. Only the three forms git commonly takes over the network
 * are accepted; anything else, including local paths, is refused.
 */
export function validateForkUrl(url: string | null | undefined): string | null {
  const trimmed = (url ?? '').trim()
  if (trimmed === '') return null
  const ok = /^https:\/\/\S+$/.test(trimmed) || /^ssh:\/\/\S+$/.test(trimmed) || /^git@[^\s:]+:\S+$/.test(trimmed)
  if (!ok) {
    throw new Error('The fork must be a git URL, such as https://github.com/you/roster.git.')
  }
  return trimmed
}
