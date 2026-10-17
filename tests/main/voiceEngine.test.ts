import { describe, expect, test } from 'vitest'
import { selectVoiceEngine } from '@main/voice/engine'

describe('selectVoiceEngine', () => {
  test('keeps Apple as the default on macOS during the acceptance window', () => {
    expect(selectVoiceEngine(undefined, 'darwin')).toEqual({ engine: 'apple' })
  })

  test('keeps other platforms off until the matrix is accepted', () => {
    expect(selectVoiceEngine(undefined, 'win32').engine).toBe('off')
  })

  test('allows the portable engine explicitly on every platform', () => {
    expect(selectVoiceEngine('transformers', 'linux')).toEqual({ engine: 'transformers' })
  })

  test('fails an invalid or impossible override closed', () => {
    expect(selectVoiceEngine('apple', 'win32').engine).toBe('off')
    expect(selectVoiceEngine('surprise', 'darwin')).toEqual({
      engine: 'off',
      reason: 'Unknown ROSTER_VOICE_ENGINE value: surprise.',
    })
  })
})
