import { sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { augmentedEnv } from '@main/auth/probes'

const ORIGINAL_PATH = process.env['PATH']

beforeEach(() => {
  process.env['PATH'] = ORIGINAL_PATH
})

afterEach(() => {
  process.env['PATH'] = ORIGINAL_PATH
})

function pathEntries(): string[] {
  return (augmentedEnv()['PATH'] ?? '').split(':')
}

describe('augmentedEnv', () => {
  test('drops node_modules/.bin, which holds Roster’s own bundled CLIs', () => {
    // Otherwise Roster drives the copy it vendored rather than the user's
    // install, which defeats running on their account.
    process.env['PATH'] = `/usr/bin:/work/node_modules${sep}.bin:/bin`

    expect(pathEntries()).not.toContain(`/work/node_modules${sep}.bin`)
    expect(pathEntries()).toContain('/usr/bin')
  })

  test('appends the usual install locations a launched .app would miss', () => {
    process.env['PATH'] = '/usr/bin'
    const entries = pathEntries()

    expect(entries).toContain('/opt/homebrew/bin')
    expect(entries).toContain('/usr/local/bin')
  })

  test('does not duplicate a location already present', () => {
    process.env['PATH'] = '/opt/homebrew/bin:/usr/bin'
    const entries = pathEntries()

    expect(entries.filter((dir) => dir === '/opt/homebrew/bin')).toHaveLength(1)
  })

  test('keeps the inherited entries ahead of the appended ones', () => {
    process.env['PATH'] = '/first:/second'
    const entries = pathEntries()

    expect(entries.indexOf('/first')).toBeLessThan(entries.indexOf('/opt/homebrew/bin'))
  })

  test('drops empty segments rather than producing a bare colon', () => {
    process.env['PATH'] = '/usr/bin::/bin'
    expect(pathEntries()).not.toContain('')
  })

  test('still yields a usable PATH when none was inherited', () => {
    delete process.env['PATH']
    expect(pathEntries().length).toBeGreaterThan(0)
  })

  test('carries the rest of the environment through', () => {
    process.env['ROSTER_PROBE_MARKER'] = 'kept'
    expect(augmentedEnv()['ROSTER_PROBE_MARKER']).toBe('kept')
    delete process.env['ROSTER_PROBE_MARKER']
  })
})
