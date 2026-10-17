import { spawn } from 'node:child_process'
import { developmentScript } from './developmentLaunch.mjs'

const npm = process.env.npm_execpath
if (!npm) throw new Error('Start development with npm run dev or npm run dev:debug.')
const args = process.argv.slice(2)
const script = developmentScript(process.platform, args.includes('--debug'))
if (process.platform === 'darwin') {
  console.log('Launching the macOS app for voice permissions. Re-run after edits; dev:hot provides hot reload without reliable voice permissions from editors.')
}
const extra = args.filter((arg) => arg !== '--debug')
const child = spawn(process.execPath, [npm, 'run', script, '--', ...extra], { stdio: 'inherit' })
child.once('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.once('exit', (code) => { process.exitCode = code ?? 1 })
