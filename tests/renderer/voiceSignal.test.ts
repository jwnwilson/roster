import { describe, expect, test } from 'vitest'
import { inspectVoiceSignal } from '@/chat/voice/signal'

function tone(seconds: number, amplitude = 0.1): Float32Array {
  return Float32Array.from({ length: Math.floor(seconds * 16_000) }, (_, i) => amplitude * Math.sin(i * 2 * Math.PI * 220 / 16_000))
}

describe('voice input signal guard (not speech recognition)', () => {
  test('rejects empty, silent and constant/DC input', () => {
    expect(inspectVoiceSignal(new Float32Array()).usable).toBe(false)
    expect(inspectVoiceSignal(new Float32Array(16_000)).usable).toBe(false)
    expect(inspectVoiceSignal(new Float32Array(16_000).fill(0.2)).usable).toBe(false)
  })

  test('rejects non-finite and out-of-range PCM', () => {
    for (const sample of [NaN, Infinity, -Infinity, 2]) {
      const audio = tone(1)
      audio[100] = sample
      expect(inspectVoiceSignal(audio).valid).toBe(false)
    }
  })

  test('does not confuse a brief click with sustained input', () => {
    const audio = new Float32Array(16_000)
    audio[800] = 1
    expect(inspectVoiceSignal(audio).usable).toBe(false)
  })

  test('preserves short and quiet signals rather than filtering words', () => {
    expect(inspectVoiceSignal(tone(0.3, 0.005)).usable).toBe(true)
    expect(inspectVoiceSignal(tone(0.3, 0.0002)).usable).toBe(true)
    expect(inspectVoiceSignal(tone(1, 0.00001)).usable).toBe(false)
  })

  test('rejects low-level deterministic noise without boosting it', () => {
    let seed = 42
    const audio = Float32Array.from({ length: 48_000 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return (seed / 0x100000000 - 0.5) * 0.0001
    })
    expect(inspectVoiceSignal(audio).usable).toBe(false)
  })

  test('uses active duration, not whole-clip average, for speech surrounded by silence', () => {
    const audio = new Float32Array(16_000 * 60)
    audio.set(tone(0.3, 0.005), 16_000 * 30)
    expect(inspectVoiceSignal(audio).usable).toBe(true)
  })
})
