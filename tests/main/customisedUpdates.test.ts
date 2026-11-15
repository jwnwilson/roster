import { describe, expect, test, vi } from 'vitest'
import { shouldCheckForUpdatesOnLaunch, Updater } from '@main/update/updater'
import type { UpdateState } from '@shared/types'

describe('updates in a customised copy', () => {
  test('ROSTER_CUSTOMISED=1 turns the launch check off, packaged or not', () => {
    expect(shouldCheckForUpdatesOnLaunch(true, undefined, '1')).toBe(false)
    expect(shouldCheckForUpdatesOnLaunch(false, '1', '1')).toBe(false)
  })

  test('the official app keeps its existing behaviour', () => {
    expect(shouldCheckForUpdatesOnLaunch(true, undefined, undefined)).toBe(true)
    expect(shouldCheckForUpdatesOnLaunch(true, undefined, '0')).toBe(true)
  })

  test('a disabled updater never asks GitHub, even when the user presses check', async () => {
    const fetch = vi.fn()
    const updater = new Updater({
      currentVersion: '0.1.0',
      arch: 'arm64',
      downloadDir: '/tmp',
      fetch: fetch as unknown as typeof globalThis.fetch,
      disabled: true,
    })
    const states: UpdateState[] = []
    updater.subscribe((state) => states.push(state))

    await updater.check()

    expect(fetch).not.toHaveBeenCalled()
    expect(states).toEqual([{ status: 'current' }])
  })
})
