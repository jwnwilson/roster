import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Updater } from '@main/update/updater'
import type { UpdateState } from '@shared/types'

let downloads: string
let states: UpdateState[]

beforeEach(async () => {
  downloads = await mkdtemp(join(tmpdir(), 'roster-update-'))
  states = []
})

afterEach(async () => {
  await rm(downloads, { recursive: true, force: true })
})

const RELEASE = {
  tag_name: 'v0.1.2',
  body: 'Adds the Spend screen.',
  html_url: 'https://github.com/jwnwilson/roster/releases/tag/v0.1.2',
  assets: [
    {
      name: 'Roster-0.1.2-arm64.dmg',
      browser_download_url: 'https://example.test/Roster-0.1.2-arm64.dmg',
      size: 4,
    },
  ],
}

/** A fetch that answers the release endpoint, and serves "DMG!" as the file. */
function fakeFetch(release: unknown = RELEASE) {
  return vi.fn(async (input: string | Request | URL) => {
    if (String(input).includes('releases/latest')) {
      return { ok: true, status: 200, json: async () => release } as unknown as Response
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(body.length) }),
      body: streamOf(body),
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    } as unknown as Response
  })
}

/** The installer bytes, delivered in chunks so progress has something to report. */
const body = 'DMG!'.repeat(64)

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close()
      controller.enqueue(bytes.slice(offset, offset + 16))
      offset += 16
    },
  })
}

function anUpdater(overrides: Partial<ConstructorParameters<typeof Updater>[0]> = {}) {
  const updater = new Updater({
    currentVersion: '0.1.1',
    arch: 'arm64',
    downloadDir: downloads,
    fetch: fakeFetch(),
    ...overrides,
  })
  updater.subscribe((state) => states.push(state))
  return updater
}

/* -------------------------------------------------------------- checking */

describe('Updater.check', () => {
  test('offers a release newer than what is running', async () => {
    await anUpdater().check()

    expect(states.at(-1)).toEqual({
      status: 'available',
      version: '0.1.2',
      notes: 'Adds the Spend screen.',
      url: 'https://github.com/jwnwilson/roster/releases/tag/v0.1.2',
    })
  })

  test('says checking first, so the manual button responds immediately', async () => {
    await anUpdater().check()

    expect(states[0]).toEqual({ status: 'checking' })
  })

  test('strips the tag prefix, so the UI shows 0.1.2 rather than v0.1.2', async () => {
    await anUpdater().check()

    expect(states.at(-1)).toMatchObject({ version: '0.1.2' })
  })

  test('reports nothing to do when running the latest', async () => {
    await anUpdater({ currentVersion: '0.1.2' }).check()

    expect(states.at(-1)).toEqual({ status: 'current' })
  })

  test('reports nothing to do when running ahead of the release', async () => {
    await anUpdater({ currentVersion: '0.2.0' }).check()

    expect(states.at(-1)).toEqual({ status: 'current' })
  })

  test('does not offer a release with no build for this architecture', async () => {
    await anUpdater({ arch: 'x64' }).check()

    expect(states.at(-1)).toEqual({ status: 'current' })
  })

  test('surfaces a network failure when the user asked for the check', async () => {
    const fetch = vi.fn(async (): Promise<Response> => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com')
    })
    await anUpdater({ fetch }).check()

    expect(states.at(-1)).toMatchObject({ status: 'error' })
  })

  test('stays quiet about a failed launch check, which is usually just offline', async () => {
    const fetch = vi.fn(async (): Promise<Response> => {
      throw new Error('offline')
    })
    await anUpdater({ fetch }).check({ silent: true })

    expect(states.at(-1)).toEqual({ status: 'current' })
  })

  test('treats a rate-limit body as no release rather than crashing', async () => {
    await anUpdater({ fetch: fakeFetch({ message: 'API rate limit exceeded' }) }).check()

    expect(states.at(-1)).toMatchObject({ status: 'error' })
  })

  test('treats a non-200 as an error', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response)
    await anUpdater({ fetch }).check()

    expect(states.at(-1)).toMatchObject({ status: 'error' })
  })
})

describe('Updater.subscribe', () => {
  test('starts idle, so the UI has something to render before any check', () => {
    expect(anUpdater().current()).toEqual({ status: 'idle' })
  })

  test('remembers the last state, which the install handler reads back', async () => {
    const updater = anUpdater()
    await updater.check()

    expect(updater.current()).toMatchObject({ status: 'available', version: '0.1.2' })
  })

  test('stops delivering once unsubscribed', async () => {
    const updater = new Updater({
      currentVersion: '0.1.1',
      arch: 'arm64',
      downloadDir: downloads,
      fetch: fakeFetch(),
    })
    const seen: UpdateState[] = []
    const stop = updater.subscribe((state) => seen.push(state))

    stop()
    await updater.check()

    expect(seen).toEqual([])
  })
})

/* ------------------------------------------------------------ downloading */

describe('Updater.download', () => {
  test('writes the installer and reports where it landed', async () => {
    const updater = anUpdater()
    await updater.check()
    await updater.download()

    const final = states.at(-1)
    expect(final).toMatchObject({ status: 'ready', version: '0.1.2' })

    const path = final?.status === 'ready' ? final.path : ''
    expect(path).toBe(join(downloads, 'Roster-0.1.2-arm64.dmg'))
    expect(await readFile(path, 'utf8')).toBe(body)
  })

  test('reports progress on the way, not just at the end', async () => {
    const updater = anUpdater()
    await updater.check()
    await updater.download()

    const percents = states
      .filter((state) => state.status === 'downloading')
      .map((state) => (state.status === 'downloading' ? state.percent : -1))

    // A bar that only moves when the download finishes is no bar at all.
    expect(percents.length).toBeGreaterThan(2)
    expect(percents.some((percent) => percent > 0 && percent < 100)).toBe(true)
    expect([...percents]).toEqual([...percents].sort((a, b) => a - b))
  })

  test('refuses to download before a check has found anything', async () => {
    await anUpdater().download()

    expect(states.at(-1)).toMatchObject({ status: 'error' })
  })

  test('surfaces a failed download rather than leaving it spinning', async () => {
    const fetch = vi.fn(async (input: string | Request | URL) => {
      if (String(input).includes('releases/latest')) {
        return { ok: true, status: 200, json: async () => RELEASE } as unknown as Response
      }
      return { ok: false, status: 500 } as unknown as Response
    })
    const updater = anUpdater({ fetch })
    await updater.check()
    await updater.download()

    expect(states.at(-1)).toMatchObject({ status: 'error' })
  })
})
