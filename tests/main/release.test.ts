import { describe, expect, test } from 'vitest'
import { compareVersions, isNewer, parseRelease, pickAsset } from '@main/update/release'

/* ------------------------------------------------------------- comparing */

describe('compareVersions', () => {
  test('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.2.0', '0.1.9')).toBe(1)
    expect(compareVersions('0.1.2', '0.1.1')).toBe(1)
    expect(compareVersions('0.1.1', '0.1.2')).toBe(-1)
  })

  test('treats equal versions as equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  test('ignores a leading v, since tags carry one and app.getVersion does not', () => {
    expect(compareVersions('v0.1.2', '0.1.2')).toBe(0)
    expect(compareVersions('v0.2.0', '0.1.9')).toBe(1)
  })

  test('compares numerically, not as text', () => {
    // "10" sorts before "9" as a string; it must not here.
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
  })

  test('treats a missing segment as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.3', '1.2.9')).toBe(1)
  })

  test('ignores a prerelease suffix rather than guessing its precedence', () => {
    expect(compareVersions('0.1.2-beta.1', '0.1.2')).toBe(0)
  })

  test('sorts unparseable input below anything real instead of throwing', () => {
    expect(compareVersions('not-a-version', '0.0.1')).toBe(-1)
  })
})

describe('isNewer', () => {
  test('is true only when the candidate is ahead', () => {
    expect(isNewer('0.1.1', '0.1.2')).toBe(true)
    expect(isNewer('0.1.1', '0.1.1')).toBe(false)
    expect(isNewer('0.1.2', '0.1.1')).toBe(false)
  })

  test('handles the tag/version mismatch it exists for', () => {
    expect(isNewer('0.1.1', 'v0.1.2')).toBe(true)
  })
})

/* --------------------------------------------------------------- parsing */

const RELEASE = {
  tag_name: 'v0.1.2',
  body: 'Adds the Spend screen.',
  html_url: 'https://github.com/jwnwilson/roster/releases/tag/v0.1.2',
  assets: [
    {
      name: 'Roster-0.1.2-arm64.dmg',
      browser_download_url: 'https://example.test/Roster-0.1.2-arm64.dmg',
      size: 120,
    },
    {
      name: 'Roster-0.1.2-x64.dmg',
      browser_download_url: 'https://example.test/Roster-0.1.2-x64.dmg',
      size: 130,
    },
  ],
}

describe('parseRelease', () => {
  test('reads the fields the update row needs', () => {
    const release = parseRelease(RELEASE)

    expect(release?.version).toBe('v0.1.2')
    expect(release?.notes).toBe('Adds the Spend screen.')
    expect(release?.url).toBe('https://github.com/jwnwilson/roster/releases/tag/v0.1.2')
    expect(release?.assets).toHaveLength(2)
    expect(release?.assets[0]?.url).toBe('https://example.test/Roster-0.1.2-arm64.dmg')
  })

  test('rejects a response with no tag rather than inventing a version', () => {
    expect(parseRelease({ ...RELEASE, tag_name: undefined })).toBeNull()
  })

  test('rejects anything that is not an object', () => {
    expect(parseRelease(null)).toBeNull()
    expect(parseRelease('rate limited')).toBeNull()
    expect(parseRelease([])).toBeNull()
  })

  test('treats a missing assets array as a release with no downloads', () => {
    expect(parseRelease({ ...RELEASE, assets: undefined })?.assets).toEqual([])
  })

  test('skips malformed assets instead of failing the whole release', () => {
    const release = parseRelease({
      ...RELEASE,
      assets: [{ name: 'broken' }, RELEASE.assets[0]],
    })

    expect(release?.assets).toHaveLength(1)
    expect(release?.assets[0]?.name).toBe('Roster-0.1.2-arm64.dmg')
  })

  test('defaults absent release notes to empty rather than null', () => {
    expect(parseRelease({ ...RELEASE, body: null })?.notes).toBe('')
  })
})

/* --------------------------------------------------------------- picking */

describe('pickAsset', () => {
  const assets = parseRelease(RELEASE)?.assets ?? []

  test('picks the build matching this machine', () => {
    expect(pickAsset(assets, 'arm64')?.name).toBe('Roster-0.1.2-arm64.dmg')
    expect(pickAsset(assets, 'x64')?.name).toBe('Roster-0.1.2-x64.dmg')
  })

  test('returns nothing when the release has no build for this architecture', () => {
    expect(pickAsset(assets, 'ia32')).toBeNull()
  })

  test('returns nothing when the release carries no assets at all', () => {
    expect(pickAsset([], 'arm64')).toBeNull()
  })

  test('ignores non-dmg assets, which a release also carries', () => {
    const withBlockmap = parseRelease({
      ...RELEASE,
      assets: [
        {
          name: 'Roster-0.1.2-arm64.dmg.blockmap',
          browser_download_url: 'https://example.test/blockmap',
          size: 1,
        },
        RELEASE.assets[0],
      ],
    })?.assets

    expect(pickAsset(withBlockmap ?? [], 'arm64')?.name).toBe('Roster-0.1.2-arm64.dmg')
  })
})
