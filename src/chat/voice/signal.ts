// The worker receives normalized mono PCM at 16 kHz. This is deliberately a
// conservative input-health check, not a voice-activity/speech classifier.
const SAMPLE_RATE = 16_000
const FRAME_SAMPLES = SAMPLE_RATE * 0.02
const MIN_FRAME_RMS = 0.0001 // -80 dBFS; preserve quiet speech, reject near-silence.
const MIN_ACTIVE_SAMPLES = SAMPLE_RATE * 0.12

export interface VoiceSignal {
  valid: boolean
  usable: boolean
  activeSeconds: number
}

export function inspectVoiceSignal(audio: Float32Array): VoiceSignal {
  let activeSamples = 0
  for (let offset = 0; offset < audio.length; offset += FRAME_SAMPLES) {
    const end = Math.min(offset + FRAME_SAMPLES, audio.length)
    const count = end - offset
    let sum = 0
    let squares = 0
    for (let i = offset; i < end; i++) {
      const sample = audio[i]!
      if (!Number.isFinite(sample) || Math.abs(sample) > 1) {
        return { valid: false, usable: false, activeSeconds: 0 }
      }
      sum += sample
      squares += sample * sample
    }
    // Remove DC energy: a stuck input at a nonzero value is not useful audio.
    const variance = Math.max(0, squares / count - (sum / count) ** 2)
    if (Math.sqrt(variance) >= MIN_FRAME_RMS) activeSamples += count
  }
  return {
    valid: true,
    usable: activeSamples >= MIN_ACTIVE_SAMPLES,
    activeSeconds: activeSamples / SAMPLE_RATE,
  }
}
