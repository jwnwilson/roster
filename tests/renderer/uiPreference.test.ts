import { afterEach, describe, expect, test, vi } from 'vitest'
import { readFlag, writeFlag } from '@/lib/uiPreference'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('remembering a UI choice', () => {
  test('reads back what was written', () => {
    writeFlag('plan.expanded', true)

    expect(readFlag('plan.expanded', false)).toBe(true)
  })

  test('falls back when nothing has been stored', () => {
    expect(readFlag('plan.expanded', false)).toBe(false)
    expect(readFlag('plan.expanded', true)).toBe(true)
  })

  test('falls back when the stored value is not a flag', () => {
    window.localStorage.setItem('plan.expanded', 'maybe')

    expect(readFlag('plan.expanded', false)).toBe(false)
  })

  test('falls back when storage cannot be read', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('access denied')
    })

    expect(readFlag('plan.expanded', true)).toBe(true)
  })

  test('forgets the choice rather than throwing when storage cannot be written', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    expect(() => writeFlag('plan.expanded', true)).not.toThrow()
  })
})
