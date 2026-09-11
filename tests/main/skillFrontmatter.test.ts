import { describe, expect, test } from 'vitest'
import { hasFrontmatter, withFrontmatter } from '@main/store/skillFrontmatter'

describe('hasFrontmatter', () => {
  test('recognises a file that already opens with a block', () => {
    expect(hasFrontmatter('---\nname: x\ndescription: y\n---\n\n# X\n')).toBe(true)
  })

  test('a file that merely contains --- further down does not count', () => {
    expect(hasFrontmatter('# X\n\nsome prose\n\n---\n\nmore\n')).toBe(false)
  })

  test('tolerates a leading blank line, which an editor may well leave', () => {
    expect(hasFrontmatter('\n---\nname: x\n---\n')).toBe(true)
  })

  test('an empty file has none', () => {
    expect(hasFrontmatter('')).toBe(false)
  })
})

describe('withFrontmatter', () => {
  const SKILL = `# Repro Harness

Turn a bug report into a minimal failing test before touching source.

## When to use

- A stack trace is in the request
`

  test('takes the name from the directory, which is what the runner matches on', () => {
    expect(withFrontmatter('repro-harness', SKILL)).toContain('name: repro-harness')
  })

  test('takes the description from the first line of prose under the heading', () => {
    expect(withFrontmatter('repro-harness', SKILL)).toContain(
      'description: "Turn a bug report into a minimal failing test before touching source."',
    )
  })

  test('leaves the body exactly as it was', () => {
    expect(withFrontmatter('repro-harness', SKILL).endsWith(SKILL)).toBe(true)
  })

  test('returns a file that already has frontmatter untouched', () => {
    const already = '---\nname: x\ndescription: y\n---\n\n# X\n'

    expect(withFrontmatter('anything', already)).toBe(already)
  })

  test('falls back to the heading when there is no prose to describe it', () => {
    expect(withFrontmatter('stack-triage', '# Stack Triage\n')).toContain(
      'description: "Stack Triage"',
    )
  })

  test('falls back to the name when there is no heading either', () => {
    expect(withFrontmatter('stack-triage', '')).toContain('description: "stack-triage"')
  })

  test('escapes a description that would otherwise break the YAML', () => {
    // A colon starts a mapping in YAML, and a quote ends the scalar.
    const skill = '# X\n\nRead a trace: find the "first" frame.\n'

    expect(withFrontmatter('x', skill)).toContain(
      'description: "Read a trace: find the \\"first\\" frame."',
    )
  })

  test('collapses a description wrapped across lines onto one', () => {
    const skill = '# X\n\nOne line on what\nthis skill is for.\n'

    expect(withFrontmatter('x', skill)).toContain(
      'description: "One line on what this skill is for."',
    )
  })

  test('caps a runaway description rather than writing a paragraph into the block', () => {
    const skill = `# X\n\n${'word '.repeat(200)}\n`
    const line = withFrontmatter('x', skill).split('\n').find((l) => l.startsWith('description:'))

    expect(line!.length).toBeLessThan(260)
    expect(line).toContain('…')
  })

  test('skips a heading-only line when looking for prose', () => {
    const skill = '# X\n\n## When to use\n\nThe situation that triggers it.\n'

    expect(withFrontmatter('x', skill)).toContain('description: "The situation that triggers it."')
  })
})
