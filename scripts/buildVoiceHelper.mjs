import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

// CI runs on Linux and does not need the macOS-only sidecar. Local macOS
// development does: Electron's resources directory has no packaged helper.
if (process.platform === 'darwin') {
  const output = join(process.cwd(), 'build', 'voice', 'roster-voice')
  mkdirSync(dirname(output), { recursive: true })
  const arch = process.arch === 'x64' ? 'x86_64' : 'arm64'
  execFileSync(
    'xcrun',
    [
      'swiftc',
      join(process.cwd(), 'build', 'voice', 'roster-voice.swift'),
      '-framework',
      'AVFoundation',
      '-framework',
      'Speech',
      '-target',
      `${arch}-apple-macosx10.15`,
      '-o',
      output,
    ],
    { stdio: 'inherit' },
  )
}
