import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { arch, platform } from 'node:process'
import { resolve } from 'node:path'

if (platform !== 'darwin') {
  throw new Error('dev:app is only available on macOS')
}

const outputDirectory = arch === 'arm64' ? 'mac-arm64' : 'mac'
const appPath = resolve('release', outputDirectory, 'Roster.app')

if (!existsSync(appPath)) {
  throw new Error(`Local app bundle was not produced at ${appPath}`)
}

const opener = spawn('open', ['-n', appPath], { stdio: 'inherit' })
opener.once('error', (error) => {
  throw error
})
opener.once('exit', (code) => {
  process.exitCode = code ?? 1
})
