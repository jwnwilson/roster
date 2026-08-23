import { describe, expect, test } from 'vitest'
import { STATUSES } from '@shared/types'
import { statusColor, statusLabel, transcriptOpacity } from '@shared/status'

describe('status vocabulary', () => {
  test('every status has a colour and a label', () => {
    for (const status of STATUSES) {
      expect(statusColor(status)).toMatch(/^var\(--color-/)
      expect(statusLabel(status)).not.toBe('')
    }
  })

  test('uses the handoff wording rather than the raw status name', () => {
    // Arrange / Act / Assert — these two are deliberately not their key.
    expect(statusLabel('approval')).toBe('needs you')
    expect(statusLabel('done')).toBe('finished')
  })
})

describe('transcriptOpacity', () => {
  test('renders the newest line fully opaque', () => {
    expect(transcriptOpacity(3, 4)).toBe(1)
  })

  test('fades each older line by one step', () => {
    expect(transcriptOpacity(2, 4)).toBeCloseTo(0.84)
    expect(transcriptOpacity(1, 4)).toBeCloseTo(0.68)
  })

  test('floors at 0.45 so old lines stay legible', () => {
    // A ten-line transcript would otherwise fade past invisible.
    expect(transcriptOpacity(0, 10)).toBe(0.45)
  })

  test('treats a single line as newest', () => {
    expect(transcriptOpacity(0, 1)).toBe(1)
  })
})
