import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Non-macOS hosts do not need this sidecar. Development builds embed the
// same privacy metadata as the packaged helper.
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
      '-Xlinker', '-sectcreate',
      '-Xlinker', '__TEXT',
      '-Xlinker', '__info_plist',
      '-Xlinker', join(process.cwd(), 'build', 'voice', 'Info.plist'),
      '-target',
      `${arch}-apple-macosx10.15`,
      '-o',
      output,
    ],
    { stdio: 'inherit' },
  )
}
