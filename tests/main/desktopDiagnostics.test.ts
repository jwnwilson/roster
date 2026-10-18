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

it('requests Accessibility explicitly without interpreting the asynchronous prompt as a grant', async () => {
  const run = vi.fn().mockResolvedValue('{}')
  const helper = new DesktopDiagnostics('darwin', () => '/helper', run)
  await expect(helper.requestAccessibility()).resolves.toBeUndefined()
  expect(run).toHaveBeenCalledWith('/helper', ['--request-accessibility'])
})
it('only passes a generated test identifier and the current app PID to the helper', async () => {
  const run = vi.fn().mockResolvedValue('{}')
  const helper = new DesktopDiagnostics('darwin', () => '/helper', run)
  await expect(helper.typeTest('arbitrary text')).rejects.toThrow('Invalid')
  expect(run).not.toHaveBeenCalled()
  const nonce = '12345678-1234-1234-1234-123456789abc'
  await helper.typeTest(nonce)
  expect(run).toHaveBeenCalledWith('/helper', ['--type-test', String(process.pid), nonce])
})
