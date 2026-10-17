import { describe, expect, test, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { localAppPath, openArguments, openLocalApp } from '../../scripts/localAppLaunch.mjs'

describe('local macOS app launch', () => {
  test('prepares Electron before packaging the local app bundle', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>
    expect(scripts['dev:app']).toMatch(/^npm run prepare:dev && npm run build/)
    expect(scripts['dev:app:debug']).toMatch(/^npm run prepare:dev && npm run build/)
  })

  test('uses an absolute architecture-specific app bundle path', () => {
    expect(localAppPath('/worktrees/voice', 'arm64')).toBe(
      '/worktrees/voice/release/mac-arm64/Roster.app',
    )
    expect(localAppPath('/worktrees/voice', 'x64')).toBe(
      '/worktrees/voice/release/mac/Roster.app',
    )
  })

  test('launches through Launch Services with app environment, output, and debug arguments', () => {
    expect(openArguments('/worktrees/voice/release/mac-arm64/Roster.app', {
      ROSTER_HOME: '/tmp/roster-voice',
      PATH: '/usr/local/bin:/usr/bin',
    }, ['--inspect=9229'])).toEqual([
      '-n', '-W',
      '--stdout', '/dev/stdout',
      '--stderr', '/dev/stderr',
      '--env', 'ROSTER_UPDATE_CHECK=0',
      '--env', 'ROSTER_HOME=/tmp/roster-voice',
      '--env', 'PATH=/usr/local/bin:/usr/bin',
      '/worktrees/voice/release/mac-arm64/Roster.app',
      '--args', '--inspect=9229',
    ])
  })

  test('only enables release checks for an explicit local updater test', () => {
    expect(openArguments('/app/Roster.app', { ROSTER_UPDATE_CHECK: '1' }, [])).toContain('ROSTER_UPDATE_CHECK=1')
  })

  test('keeps the command alive until the launched app exits', async () => {
    const child = {
      once: vi.fn((event: string, listener: (code?: number) => void) => {
        if (event === 'exit') listener(0)
        return child
      }),
    }
    const spawn = vi.fn(() => child as unknown as ChildProcess)
    await openLocalApp('/app/Roster.app', { PATH: '/usr/bin' }, [], spawn)
    expect(spawn).toHaveBeenCalledWith('open', expect.arrayContaining(['-W', '/app/Roster.app']), {
      stdio: 'inherit',
    })
  })
})
