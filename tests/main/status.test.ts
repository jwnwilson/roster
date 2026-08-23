import { describe, expect, test } from 'vitest'
import { STATUSES } from '@shared/types'
import {
  rollUpAgentStatus,
  statusColor,
  statusLabel,
  transcriptOpacity,
} from '@shared/status'

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

describe('rollUpAgentStatus', () => {
  test('an agent with no sessions is idle', () => {
    expect(rollUpAgentStatus('idle', [])).toBe('idle')
  })

  test('a blocked session outranks everything else', () => {
    // Needing you is the most urgent thing a card can say.
    expect(rollUpAgentStatus('idle', ['done', 'running', 'approval'])).toBe('approval')
  })

  test('a running session outranks finished ones', () => {
    expect(rollUpAgentStatus('idle', ['done', 'running', 'idle'])).toBe('running')
  })

  test('a failed session shows through once nothing is active', () => {
    expect(rollUpAgentStatus('idle', ['done', 'error'])).toBe('error')
  })

  test('but activity outranks a past failure', () => {
    expect(rollUpAgentStatus('idle', ['error', 'running'])).toBe('running')
  })

  test('finished work shows when nothing needs attention', () => {
    expect(rollUpAgentStatus('idle', ['idle', 'done'])).toBe('done')
  })

  test('an unusable runner outranks any session state', () => {
    // Nothing can run, so a stale "running" must not imply otherwise.
    expect(rollUpAgentStatus('error', ['running', 'approval'])).toBe('error')
  })

  test('every rolled-up status is one the design defines', () => {
    for (const status of STATUSES) {
      expect(STATUSES).toContain(rollUpAgentStatus('idle', [status]))
    }
  })
})
