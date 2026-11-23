import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'

/**
 * The ad-hoc signing step in `build/afterPack.cjs`. Without it a downloaded
 * Roster is reported as "damaged": electron-builder skips signing when there is
 * no certificate, which leaves the bundle unsealed.
 *
 * Loaded through `createRequire` for the same reason as packagingGuard.test.ts.
 */
const require_ = createRequire(import.meta.url)
const { adHocSignArgs, sealCheckArgs } = require_('../../build/afterPack.cjs') as {
  adHocSignArgs: (appPath: string) => string[]
  sealCheckArgs: (appPath: string) => string[]
}

const APP = '/out/mac-arm64/Roster.app'

describe('ad-hoc signing', () => {
  test('seals the whole bundle with an ad-hoc identity, replacing the linker signature', () => {
    expect(adHocSignArgs(APP)).toEqual(['--force', '--deep', '--sign', '-', APP])
  })

  test('does not turn on the hardened runtime, which an ad-hoc build cannot satisfy', () => {
    expect(adHocSignArgs(APP)).not.toContain('--options')
    expect(adHocSignArgs(APP).join(' ')).not.toMatch(/runtime/)
  })

  test('checks the seal strictly, so a bundle that would read as damaged fails the build', () => {
    expect(sealCheckArgs(APP)).toEqual(['--verify', '--deep', '--strict', APP])
  })

  test('signs after the Swift helper is added, so nothing lands outside the seal', () => {
    const source = readFileSync('build/afterPack.cjs', 'utf8')
    const helper = source.indexOf("'swiftc'")
    const sign = source.indexOf("execFileSync('codesign', adHocSignArgs(appPath)")
    expect(helper).toBeGreaterThan(-1)
    expect(sign).toBeGreaterThan(helper)
  })

  test('the release build is described as ad-hoc signed, not unsigned', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(workflow).not.toMatch(/Unsigned on purpose/)
    expect(workflow).toMatch(/ad-hoc/i)
  })
})
