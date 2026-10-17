import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

if (process.env.electron_config_cache === undefined) {
  const cache = join(tmpdir(), 'roster-electron-cache')
  await mkdir(cache, { recursive: true })
  process.env.electron_config_cache = cache
}

const require = createRequire(import.meta.url)
const electron = require('electron')

// electron-builder's extendInfo applies only to packaged Roster. In dev,
// macOS also needs the descriptions on the Electron host requesting access.
if (process.platform === 'darwin') {
  const plist = join(dirname(electron), '..', 'Info.plist')
  const descriptions = require('../package.json').build.mac.extendInfo
  for (const key of ['NSSpeechRecognitionUsageDescription', 'NSMicrophoneUsageDescription']) {
    execFileSync('/usr/bin/plutil', ['-replace', key, '-string', descriptions[key], plist])
  }
}

process.stdout.write(`Electron binary ready: ${electron}\n`)
