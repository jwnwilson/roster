import { describe, expect, it, vi } from 'vitest'
import { DesktopDiagnostics, desktopHelperPath } from '../../electron/main/desktop/diagnostics'

const report = { accessibilityTrusted: false, screenCaptureAllowed: false, inputPostingAllowed: false, visibleScreens: 0, frontmostApp: null }
describe('desktop diagnostics', () => {
  it('runs a read-only probe by default and validates its result', async () => {
    const run = vi.fn().mockResolvedValue(JSON.stringify(report))
    const probe = new DesktopDiagnostics('darwin', () => '/helper', run)
    expect(await probe.check()).toEqual(report)
    expect(run).toHaveBeenCalledWith('/helper', [])
  })
  it('only accepts explicit permission request commands', async () => {
    const run = vi.fn().mockResolvedValue(JSON.stringify(report))
    const probe = new DesktopDiagnostics('darwin', () => '/helper', run)
    await probe.request('accessibility')
    expect(run).toHaveBeenCalledWith('/helper', ['--request-accessibility'])
    await probe.request('screen')
    expect(run).toHaveBeenLastCalledWith('/helper', ['--request-screen'])
    await expect(probe.request('anything' as 'screen')).rejects.toThrow('Unknown desktop permission')
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('rejects unsupported platforms without launching a helper', async () => {
    const run = vi.fn()
    await expect(new DesktopDiagnostics('linux', () => '/helper', run).check()).rejects.toThrow('macOS')
    expect(run).not.toHaveBeenCalled()
  })
  it('reports malformed or failed helper responses', async () => {
    for (const output of ['bad JSON', '{}', JSON.stringify({ ...report, visibleScreens: -1 })]) {
      await expect(new DesktopDiagnostics('darwin', () => '/helper', async () => output).check()).rejects.toThrow()
    }
    await expect(new DesktopDiagnostics('darwin', () => '/missing', async () => { throw new Error('missing helper') }).check()).rejects.toThrow('missing helper')
  })
  it('resolves development and packaged helper locations', () => {
    expect(desktopHelperPath(true, '/resources', '/repo')).toBe('/resources/desktop/roster-desktop')
    expect(desktopHelperPath(false, '/resources', '/repo')).toBe('/repo/build/desktop/roster-desktop')
  })
})
