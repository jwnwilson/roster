/**
 * Reading GitHub's release JSON, and deciding whether it is worth offering.
 *
 * Pure on purpose: no electron, no network, no filesystem. Everything that
 * decides *whether* to update lives here so it can be tested directly, while
 * the module that actually fetches and writes stays thin.
 */

/** One downloadable file attached to a release. */
export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface Release {
  /** The tag as published, which carries a leading "v". */
  version: string
  notes: string
  url: string
  assets: ReleaseAsset[]
}

/** Trailing prerelease/build metadata, which this deliberately ignores. */
const SUFFIX = /[-+].*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Version as a numeric triple.
 *
 * Returns null for anything unparseable rather than coercing it to zeroes,
 * so garbage sorts below a real version instead of tying with 0.0.0.
 */
function segments(version: string): number[] | null {
  const cleaned = version.trim().replace(/^v/, '').replace(SUFFIX, '')
  if (!/^\d+(\.\d+)*$/.test(cleaned)) return null

  return cleaned.split('.').map(Number)
}

/**
 * Compare two versions, tolerating the "v" that tags carry and
 * `app.getVersion()` does not. Missing segments count as zero.
 */
export function compareVersions(a: string, b: string): number {
  const left = segments(a)
  const right = segments(b)

  if (!left && !right) return 0
  if (!left) return -1
  if (!right) return 1

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/** Whether `candidate` is worth offering to someone running `current`. */
export function isNewer(current: string, candidate: string): boolean {
  return compareVersions(candidate, current) > 0
}

function parseAsset(value: unknown): ReleaseAsset | null {
  if (!isRecord(value)) return null

  const name = value['name']
  const url = value['browser_download_url']
  if (typeof name !== 'string' || typeof url !== 'string') return null

  const size = value['size']
  return { name, url, size: typeof size === 'number' ? size : 0 }
}

/**
 * Read GitHub's `releases/latest` payload.
 *
 * External JSON, so nothing is trusted: a response missing its tag is no
 * release at all, and a malformed asset is dropped rather than taking the
 * whole release down with it — a rate-limit body reaches here too.
 */
export function parseRelease(json: unknown): Release | null {
  if (!isRecord(json)) return null

  const version = json['tag_name']
  if (typeof version !== 'string' || version.length === 0) return null

  const notes = json['body']
  const url = json['html_url']
  const assets = json['assets']

  return {
    version,
    notes: typeof notes === 'string' ? notes : '',
    url: typeof url === 'string' ? url : '',
    assets: Array.isArray(assets)
      ? assets.map(parseAsset).filter((asset): asset is ReleaseAsset => asset !== null)
      : [],
  }
}

/**
 * The build for this machine.
 *
 * Matched on the `-<arch>.dmg` suffix that the artifactName in package.json
 * guarantees. Blockmaps and other attachments share the arch marker but not
 * the extension, so the suffix must be the whole ending.
 */
export function pickAsset(assets: readonly ReleaseAsset[], arch: string): ReleaseAsset | null {
  const suffix = `-${arch}.dmg`
  return assets.find((asset) => asset.name.endsWith(suffix)) ?? null
}
