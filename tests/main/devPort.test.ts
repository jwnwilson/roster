import { describe, expect, test } from 'vitest'
import { DEFAULT_DEV_PORT, parseDevPort } from '@shared/devPort'

describe('parseDevPort', () => {
  test('defaults to the port Roster has always used', () => {
    expect(DEFAULT_DEV_PORT).toBe(5173)
    expect(parseDevPort(undefined)).toBe(5173)
    expect(parseDevPort('')).toBe(5173)
  })

  test('accepts a whole port number from ROSTER_DEV_PORT', () => {
    expect(parseDevPort('5180')).toBe(5180)
  })

  test('rejects anything that is not a usable TCP port', () => {
    expect(() => parseDevPort('abc')).toThrow(/ROSTER_DEV_PORT/)
    expect(() => parseDevPort('0')).toThrow(/ROSTER_DEV_PORT/)
    expect(() => parseDevPort('70000')).toThrow(/ROSTER_DEV_PORT/)
    expect(() => parseDevPort('5173.5')).toThrow(/ROSTER_DEV_PORT/)
  })
})
