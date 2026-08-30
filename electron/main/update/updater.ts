import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { UpdateState } from '../../../shared/types'
import { isNewer, parseRelease, pickAsset, type ReleaseAsset } from './release'

/**
 * Checking for, fetching, and handing over a new build.
 *
 * Roster ships unsigned, so it cannot swap its own bundle the way a signed
 * app can — Squirrel refuses an update it cannot verify. Instead this fetches
 * the DMG for the running architecture and leaves it for the user to install,
 * which is the honest version of "reinstall the app" without a Developer ID.
 *
 * Everything it touches is injected, so it runs under test without Electron.
 */

const LATEST_RELEASE = 'https://api.github.com/repos/jwnwilson/roster/releases/latest'

/** GitHub rejects unidentified callers. */
const HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'Roster',
}

export interface UpdaterOptions {
  currentVersion: string
  /** `process.arch` — which build to look for. */
  arch: string
  downloadDir: string
  fetch: typeof globalThis.fetch
  /** Overridable so tests need not reach GitHub. */
  releaseUrl?: string
}

export interface CheckOptions {
  /**
   * Swallow failures. The check on launch is silent because a laptop is
   * offline often enough that an error banner would be noise; a check the
   * user asked for is not.
   */
  silent?: boolean
}

type Listener = (state: UpdateState) => void

export class Updater {
  private readonly listeners = new Set<Listener>()
  private state: UpdateState = { status: 'idle' }
  /** Set by a successful check, consumed by download. */
  private pending: { version: string; asset: ReleaseAsset } | null = null

  constructor(private readonly options: UpdaterOptions) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  current(): UpdateState {
    return this.state
  }

  private emit(state: UpdateState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }

  /** Look for a release newer than the running version. */
  async check({ silent = false }: CheckOptions = {}): Promise<void> {
    this.emit({ status: 'checking' })

    try {
      const response = await this.options.fetch(this.options.releaseUrl ?? LATEST_RELEASE, {
        headers: HEADERS,
      })
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`)

      const release = parseRelease(await response.json())
      if (!release) throw new Error('no release published')

      const asset = pickAsset(release.assets, this.options.arch)

      // A release with no build for this machine is nothing this app can
      // offer, so it reads as up to date rather than as a broken update.
      if (!isNewer(this.options.currentVersion, release.version) || !asset) {
        this.pending = null
        this.emit({ status: 'current' })
        return
      }

      const version = release.version.replace(/^v/, '')
      this.pending = { version, asset }
      this.emit({ status: 'available', version, notes: release.notes, url: release.url })
    } catch (cause) {
      this.pending = null
      this.emit(silent ? { status: 'current' } : { status: 'error', message: message(cause) })
    }
  }

  /** Fetch the pending build into the downloads folder. */
  async download(): Promise<void> {
    const pending = this.pending
    if (!pending) {
      this.emit({ status: 'error', message: 'No update to download.' })
      return
    }

    const { version, asset } = pending
    this.emit({ status: 'downloading', version, percent: 0 })

    try {
      const response = await this.options.fetch(asset.url, { headers: HEADERS })
      if (!response.ok) throw new Error(`Download failed (${response.status})`)

      const total = Number(response.headers.get('content-length')) || asset.size
      const bytes = await this.readWithProgress(response, version, total)

      await mkdir(this.options.downloadDir, { recursive: true })
      const path = join(this.options.downloadDir, asset.name)
      await writeFile(path, bytes)

      this.emit({ status: 'ready', version, path })
    } catch (cause) {
      this.emit({ status: 'error', message: message(cause) })
    }
  }

  /**
   * Drain the body, reporting how far along it is.
   *
   * A build is ~100MB, so a bar that only moves at the end is no better than
   * no bar. Emissions are throttled to whole percent steps, since every one
   * of them crosses IPC and repaints the sidebar.
   */
  private async readWithProgress(
    response: Response,
    version: string,
    total: number,
  ): Promise<Buffer> {
    const body = response.body
    if (!body) return Buffer.from(await response.arrayBuffer())

    const chunks: Uint8Array[] = []
    let read = 0
    let reported = 0
    const reader = body.getReader()

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      chunks.push(value)
      read += value.byteLength

      // Without a length the server never sent, there is no percentage to
      // report — the UI shows an indeterminate state rather than a wrong one.
      const percent = total > 0 ? Math.min(99, Math.floor((read / total) * 100)) : 0
      if (percent > reported) {
        reported = percent
        this.emit({ status: 'downloading', version, percent })
      }
    }

    return Buffer.concat(chunks)
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
