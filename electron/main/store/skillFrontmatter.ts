/**
 * YAML frontmatter for a SKILL.md.
 *
 * Roster's skill library predates Claude Code's frontmatter convention, so
 * every skill written before this — the five seeded ones included — is plain
 * Markdown. Such a file does still load, but badly, in two measured ways:
 *
 *  - Its description falls back to the H1 alone. The description is what the
 *    model reads when deciding whether a skill applies, so "Repro Harness"
 *    where the author wrote "Turn a bug report into a minimal failing test
 *    before touching source" is the difference between a skill being chosen
 *    and being passed over.
 *  - It gets no bare-name alias, answering only to `<plugin>:<name>`. The
 *    agent's own `skills` list holds bare names, so the two can fail to meet.
 *
 * The description therefore comes from the skill's own first line of prose
 * rather than a placeholder: the author already wrote the summary, one line
 * under the title, and inventing a different one would describe it worse.
 */

/** Long enough for a sentence, short enough not to be a paragraph. */
const MAX_DESCRIPTION = 200

export function hasFrontmatter(source: string): boolean {
  return source.trimStart().startsWith('---\n')
}

/**
 * The file with a frontmatter block, or unchanged when it already has one.
 *
 * `name` comes from the directory rather than the title: that is the name the
 * library, an agent's `skills` list and the runner's own filter all use, and a
 * block naming the skill something else would hide it from all three.
 */
export function withFrontmatter(name: string, source: string): string {
  if (hasFrontmatter(source)) return source

  const block = ['---', `name: ${name}`, `description: ${yaml(describe(name, source))}`, '---', '']

  return `${block.join('\n')}\n${source}`
}

/**
 * The skill's own summary: the first line of prose under its heading, else the
 * heading, else the name. Something is always returned, because a skill with
 * no description is a skill the model will never choose.
 */
function describe(name: string, source: string): string {
  const lines = source.split('\n')
  const heading = lines.find((line) => line.startsWith('# '))

  const prose = paragraphAfterHeading(lines)
  const chosen = prose ?? heading?.slice(2).trim() ?? ''

  return truncate(chosen === '' ? name : chosen)
}

/**
 * The first paragraph that is not a heading or a list item, joined onto one
 * line — a description is a single YAML scalar, and a skill's summary is
 * routinely wrapped across two lines in the source.
 */
function paragraphAfterHeading(lines: readonly string[]): string | null {
  const collected: string[] = []

  for (const line of lines) {
    const text = line.trim()

    if (text === '') {
      if (collected.length > 0) break
      continue
    }
    if (text.startsWith('#') || text.startsWith('-') || text.startsWith('*')) {
      if (collected.length > 0) break
      continue
    }
    collected.push(text)
  }

  return collected.length > 0 ? collected.join(' ') : null
}

function truncate(text: string): string {
  if (text.length <= MAX_DESCRIPTION) return text
  return `${text.slice(0, MAX_DESCRIPTION).trimEnd()}…`
}

/**
 * JSON string syntax is also valid YAML double-quoted-scalar syntax, so this
 * escapes the colon that would otherwise start a mapping and the quote that
 * would end the scalar early.
 */
function yaml(value: string): string {
  return JSON.stringify(value)
}
