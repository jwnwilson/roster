import { describe, expect, test, vi } from 'vitest'
import { configureElectronUserData } from '@main/electronUserData'

describe('configureElectronUserData', () => {
  test('uses ROSTER_HOME as Electron user data before the instance lock', () => {
    const setPath = vi.fn()

    configureElectronUserData({ setPath }, '/tmp/roster-isolated')

    expect(setPath).toHaveBeenCalledWith('userData', '/tmp/roster-isolated')
  })

  test('leaves Electron defaults alone when no Roster home was requested', () => {
    const setPath = vi.fn()

    configureElectronUserData({ setPath }, undefined)

    expect(setPath).not.toHaveBeenCalled()
  })
})
