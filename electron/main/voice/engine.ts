import type { VoiceEngine } from '../../../shared/voice'

export interface VoiceEngineSelection {
  engine: VoiceEngine
  reason?: string
}
/**
 * All platforms use local TypeScript/WASM inference. Migrate the old Apple
 * override rather than invoking the retired native helper. `off` remains an
 * explicit opt-out; unknown configuration fails closed.
 */
export function selectVoiceEngine(
  configured = process.env['ROSTER_VOICE_ENGINE'],
  _platform = process.platform,
): VoiceEngineSelection {
  if (configured === undefined || configured === '' || configured === 'apple') {
    return { engine: 'transformers' }
  }
  if (configured === 'transformers' || configured === 'off') return { engine: configured }

  return {
    engine: 'off',
    reason: `Unknown ROSTER_VOICE_ENGINE value: ${configured}.`,
  }
}
