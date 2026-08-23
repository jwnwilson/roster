import { describe, expect, test } from 'vitest'
import { describeActivity, THINKING } from '@main/sessions/activity'

describe('describeActivity — reads as work, not as tooling', () => {
  test.each([
    ['Read', 'src/session/pool.ts', 'Reading src/session/pool.ts …'],
    ['Bash', 'pytest -k leak', 'Running pytest -k leak …'],
    ['Write', 'docs/adr/014.md', 'Writing docs/adr/014.md …'],
    ['Edit', 'src/pool.ts', 'Editing src/pool.ts …'],
    ['Grep', 'def handle_', 'Searching def handle_ …'],
    ['Glob', '**/*.test.ts', 'Looking through **/*.test.ts …'],
  ])('%s of %s reads as "%s"', (tool, args, expected) => {
    expect(describeActivity(tool, args)).toBe(expected)
  })

  test('matches a tool name whatever its casing', () => {
    // Runners disagree: Claude sends "Bash", Codex sends "shell".
    expect(describeActivity('bash', 'ls')).toBe('Running ls …')
    expect(describeActivity('BASH', 'ls')).toBe('Running ls …')
    expect(describeActivity('shell', 'ls')).toBe('Running ls …')
  })

  test('names an unfamiliar tool rather than inventing a verb', () => {
    expect(describeActivity('my_custom_tool', 'some-arg')).toBe('my_custom_tool: some-arg …')
  })

  test('an unfamiliar tool with no arguments still reads sensibly', () => {
    expect(describeActivity('my_custom_tool', '')).toBe('Running my_custom_tool …')
  })

  test('a known tool with no arguments drops the target', () => {
    expect(describeActivity('Read', '')).toBe('Reading …')
  })
})

describe('describeActivity — fits one line', () => {
  test('truncates a long argument', () => {
    const long = 'a'.repeat(200)
    const described = describeActivity('Bash', long)

    expect(described.length).toBeLessThan(80)
    expect(described).toContain('…')
  })

  test('takes only the first line of a multi-line argument', () => {
    // A Write call carries a whole file body.
    expect(describeActivity('Bash', 'echo one\necho two')).toBe('Running echo one …')
  })

  test('trims surrounding whitespace', () => {
    expect(describeActivity('Read', '   /a/b.ts   ')).toBe('Reading /a/b.ts …')
  })
})

describe('THINKING', () => {
  test('is what shows between tool calls', () => {
    // The whole point for a runner that does not stream: something is moving.
    expect(THINKING).toBe('Thinking …')
  })
})
