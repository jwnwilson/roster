import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { developmentScript } from '../../scripts/developmentLaunch.mjs'

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts

describe('default development launch', () => {
  test('forwards the worktree, environment, arguments and child failure through the real entry point', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roster-dev-launch-'))
    try {
      const npm = join(directory, 'npm.cjs')
      writeFileSync(npm, 'console.log(JSON.stringify({ args: process.argv.slice(2), home: process.env.ROSTER_HOME, cwd: process.cwd() })); process.exitCode = 7')
      const result = spawnSync(process.execPath, ['scripts/dev.mjs', '--debug', '--inspect=9230'], {
        encoding: 'utf8', env: { ...process.env, npm_execpath: npm, ROSTER_HOME: directory },
      })
      expect(result.status).toBe(7)
      const output = JSON.parse(result.stdout.trim().split('\n').at(-1)!)
      expect(output).toEqual({
        args: ['run', developmentScript(process.platform, true), '--', '--inspect=9230'],
        home: directory, cwd: process.cwd(),
      })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  test('routes the ordinary macOS commands to the application launch, including debug', () => {
    expect(scripts.dev).toBe('node scripts/dev.mjs')
    expect(scripts['dev:debug']).toBe('node scripts/dev.mjs --debug')
    expect(developmentScript('darwin', false)).toBe('dev:app')
    expect(developmentScript('darwin', true)).toBe('dev:app:debug')
  })

  test.each(['linux', 'win32'])('retains the Electron dev server on %s', (platform) => {
    expect(developmentScript(platform, false)).toBe('dev:hot')
    expect(developmentScript(platform, true)).toBe('dev:hot:debug')
    expect(scripts['dev:hot']).toBe('electron-vite dev')
    expect(scripts['dev:hot:debug']).toContain('--remoteDebuggingPort=9222')
  })

  test('prepares each concrete launch once without recursive dev hooks', () => {
    expect(scripts.predev).toBeUndefined()
    expect(scripts['predev:debug']).toBeUndefined()
    expect(scripts['predev:hot']).toBe('npm run prepare:dev')
    expect(scripts['predev:hot:debug']).toBe('npm run prepare:dev')
    expect(scripts['dev:app']).toMatch(/^npm run prepare:dev && npm run build/)
    expect(scripts['dev:app:debug']).toMatch(/^npm run prepare:dev && npm run build/)
  })
})
