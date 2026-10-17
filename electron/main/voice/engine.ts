import type { VoiceEngine } from '../../../shared/voice'

export interface VoiceEngineSelection {
  engine: VoiceEngine
  reason?: string
}
/**
 * The portable engine remains dark until its platform acceptance matrix is
 * complete. An explicit environment override is the rollback boundary used
 * during that rollout.
 */
export function selectVoiceEngine(
  configured = process.env['ROSTER_VOICE_ENGINE'],
  platform = process.platform,
): VoiceEngineSelection {
  if (configured === undefined || configured === '') {
    return platform === 'darwin'
      ? { engine: 'apple' }
      : { engine: 'off', reason: 'Voice input is not enabled on this platform yet.' }
  }

  if (configured === 'apple') {
    return platform === 'darwin'
      ? { engine: 'apple' }
      : { engine: 'off', reason: 'The Apple voice engine is available on macOS only.' }
  }
  if (configured === 'transformers' || configured === 'off') return { engine: configured }

  return {
    engine: 'off',
    reason: `Unknown ROSTER_VOICE_ENGINE value: ${configured}.`,
  }
}
