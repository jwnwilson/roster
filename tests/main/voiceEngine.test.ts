import { describe, expect, test } from 'vitest'
import { selectVoiceEngine } from '@main/voice/engine'

describe('selectVoiceEngine', () => {
  test.each(['darwin', 'win32', 'linux'] as const)('defaults to the portable engine on %s', (platform) => {
    expect(selectVoiceEngine(undefined, platform)).toEqual({ engine: 'transformers' })
    expect(selectVoiceEngine('', platform)).toEqual({ engine: 'transformers' })
    expect(selectVoiceEngine('apple', platform)).toEqual({ engine: 'transformers' })
    expect(selectVoiceEngine('off', platform)).toEqual({ engine: 'off' })
  })

  test('allows the portable engine explicitly on every platform', () => {
    expect(selectVoiceEngine('transformers', 'linux')).toEqual({ engine: 'transformers' })
  })

  test('fails an invalid or impossible override closed', () => {
    expect(selectVoiceEngine('surprise', 'darwin')).toEqual({
      engine: 'off',
      reason: 'Unknown ROSTER_VOICE_ENGINE value: surprise.',
    })
  })
})
