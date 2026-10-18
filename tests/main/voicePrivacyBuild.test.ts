import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

describe('portable voice packaging', () => {
  test('retains microphone privacy metadata without Apple Speech permission', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.build.mac.extendInfo.NSMicrophoneUsageDescription).toBeTruthy()
    expect(pkg.build.mac.extendInfo.NSSpeechRecognitionUsageDescription).toBeUndefined()
    expect(readFileSync('scripts/ensureElectron.mjs', 'utf8')).toContain('NSMicrophoneUsageDescription')
    expect(readFileSync('scripts/ensureElectron.mjs', 'utf8')).not.toContain('NSSpeechRecognitionUsageDescription')
  })

  test('does not compile or bundle the retired native helper', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.scripts['prepare:dev']).not.toContain('buildVoiceHelper')
    expect(readFileSync('build/afterPack.cjs', 'utf8')).not.toMatch(/roster-voice|buildVoiceHelper/)
    expect(existsSync('build/voice/roster-voice.swift')).toBe(false)
    expect(existsSync('scripts/buildVoiceHelper.mjs')).toBe(false)
  })
})
