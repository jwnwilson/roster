import { describe, expect, test, vi } from 'vitest'
import { SystemPermissions, mediaStatus, SETTINGS_URLS } from '@main/permissions/system'

function deps(overrides: Partial<ConstructorParameters<typeof SystemPermissions>[0]> = {}) {
  return {
    platform: 'darwin' as NodeJS.Platform,
    mediaStatus: vi.fn((kind: 'screen' | 'microphone') => (kind === 'screen' ? 'denied' : 'granted')),
    askForMicrophone: vi.fn().mockResolvedValue(true),
    promptForScreen: vi.fn().mockResolvedValue(undefined),
    helper: {
      check: vi.fn().mockResolvedValue({ accessibilityTrusted: true }),
      requestAccessibility: vi.fn().mockResolvedValue(undefined),
    },
    openExternal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('mediaStatus', () => {
  test('passes the statuses Electron reports through unchanged', () => {
    for (const value of ['granted', 'denied', 'not-determined', 'restricted', 'unknown'] as const) {
      expect(mediaStatus(value)).toBe(value)
    }
  })

  test('reads anything else as unknown rather than granted', () => {
    expect(mediaStatus('something-new')).toBe('unknown')
    expect(mediaStatus(undefined)).toBe('unknown')
  })
})

describe('SystemPermissions.status', () => {
  test('reports Screen Recording from Roster, and Accessibility from the desktop helper', async () => {
    const report = await new SystemPermissions(deps()).status()

    expect(report).toEqual({ screen: 'denied', accessibility: 'granted', microphone: 'granted' })
  })

  test('reports Accessibility as denied when the helper says it is not trusted', async () => {
    const report = await new SystemPermissions(
      deps({ helper: { check: vi.fn().mockResolvedValue({ accessibilityTrusted: false }), requestAccessibility: vi.fn() } }),
    ).status()

    expect(report.accessibility).toBe('denied')
  })

  test('reports Accessibility as unknown when the helper cannot run', async () => {
    // A missing helper is not the same as a refused permission: say so.
    const report = await new SystemPermissions(
      deps({ helper: { check: vi.fn().mockRejectedValue(new Error('no helper')), requestAccessibility: vi.fn() } }),
    ).status()

    expect(report.accessibility).toBe('unknown')
  })

  test('marks everything not applicable off macOS, where none of these exist', async () => {
    const report = await new SystemPermissions(deps({ platform: 'linux' })).status()

    expect(report).toEqual({
      screen: 'not-applicable',
      accessibility: 'not-applicable',
      microphone: 'not-applicable',
    })
  })
})

describe('SystemPermissions.request', () => {
  test('asks for the microphone and reports the new state', async () => {
    const d = deps({ mediaStatus: vi.fn(() => 'granted') })
    const report = await new SystemPermissions(d).request('microphone')

    expect(d.askForMicrophone).toHaveBeenCalledOnce()
    expect(report.microphone).toBe('granted')
  })

  test('triggers the Screen Recording prompt by asking for a screen source', async () => {
    const d = deps()
    await new SystemPermissions(d).request('screen')

    expect(d.promptForScreen).toHaveBeenCalledOnce()
  })

  test('asks the desktop helper for Accessibility, since the helper is what uses it', async () => {
    const d = deps()
    await new SystemPermissions(d).request('accessibility')

    expect(d.helper.requestAccessibility).toHaveBeenCalledOnce()
  })
})

describe('untrusted permission names', () => {
  test('refuses a kind the renderer invents rather than requesting something', async () => {
    const d = deps()
    const service = new SystemPermissions(d)

    await expect(service.request('camera' as never)).rejects.toThrow(/Unknown permission/)
    await expect(service.openSettings('../etc' as never)).rejects.toThrow(/Unknown permission/)
    expect(d.askForMicrophone).not.toHaveBeenCalled()
    expect(d.openExternal).not.toHaveBeenCalled()
  })
})

describe('SystemPermissions.openSettings', () => {
  test('opens the System Settings pane for each permission', async () => {
    const d = deps()
    const service = new SystemPermissions(d)

    await service.openSettings('screen')
    await service.openSettings('accessibility')
    await service.openSettings('microphone')

    const opened = d.openExternal as unknown as ReturnType<typeof vi.fn>
    expect(opened.mock.calls.map((call) => call[0])).toEqual([
      SETTINGS_URLS.screen,
      SETTINGS_URLS.accessibility,
      SETTINGS_URLS.microphone,
    ])
  })

  test('uses the Privacy pane for each kind, not a generic settings page', () => {
    expect(SETTINGS_URLS.screen).toMatch(/^x-apple\.systempreferences:/)
    expect(SETTINGS_URLS.screen).toContain('Privacy_ScreenCapture')
    expect(SETTINGS_URLS.accessibility).toContain('Privacy_Accessibility')
    expect(SETTINGS_URLS.microphone).toContain('Privacy_Microphone')
  })
})
