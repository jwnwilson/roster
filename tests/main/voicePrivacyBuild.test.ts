import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

// Compile the real helper: TypeScript mocks cannot detect missing Mach-O
// privacy metadata, which makes macOS abort before any IPC reply is possible.
describe.skipIf(process.platform !== 'darwin')('voice helper privacy metadata', () => {
  test('embeds the permission plist in the native executable', () => {
    execFileSync(process.execPath, ['scripts/buildVoiceHelper.mjs'], { stdio: 'pipe' })
    const binary = readFileSync('build/voice/roster-voice')
    const plist = readFileSync('build/voice/Info.plist')
    expect(binary.includes(plist)).toBe(true)
    const sections = execFileSync('/usr/bin/otool', ['-l', 'build/voice/roster-voice'], { encoding: 'utf8' })
    expect(sections).toMatch(/sectname __info_plist\s+segname __TEXT/)
    expect(plist.toString()).toContain('<key>NSSpeechRecognitionUsageDescription</key>')
    expect(plist.toString()).toContain('<key>NSMicrophoneUsageDescription</key>')
  }, 120_000)
})
