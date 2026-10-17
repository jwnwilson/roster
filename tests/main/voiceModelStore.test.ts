import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VoiceModelStore, modelUrl } from '@main/voice/modelStore'
import type { VoiceModelManifest } from '@main/voice/modelManifest'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function manifest(contents: string, file = 'config.json'): VoiceModelManifest {
  return {
    schemaVersion: 1,
    modelId: 'test/whisper',
    revision: '0123456789abcdef',
    dtype: 'q8',
    runtime: 'onnx-wasm',
    license: 'MIT',
    files: [{ path: file, bytes: Buffer.byteLength(contents), sha256: hash(contents) }],
  }
}
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'roster-voice-model-'))
  roots.push(value)
  return value
}

describe('VoiceModelStore', () => {
  test('downloads an immutable revision, verifies it, and promotes it atomically', async () => {
    const data = '{"model":"tiny"}'
    const expected = manifest(data)
    const fetcher = vi.fn(async () => new Response(data, {
      headers: { 'content-length': String(Buffer.byteLength(data)) },
    }))
    const base = await root()
    const store = new VoiceModelStore(base, fetcher, expected)
    const progress = vi.fn()
    store.onProgress(progress)

    await expect(store.status()).resolves.toMatchObject({ state: 'missing' })
    await expect(store.download()).resolves.toMatchObject({ state: 'ready' })
    expect(fetcher).toHaveBeenCalledWith(
      'https://huggingface.co/test/whisper/resolve/0123456789abcdef/config.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ bytesDownloaded: Buffer.byteLength(data) }))
    const target = join(base, 'test', 'whisper', expected.revision, 'config.json')
    await expect(readFile(target, 'utf8')).resolves.toBe(data)
    await expect(stat(`${target}.partial`)).rejects.toThrow()
    await expect(store.fileForUrl('roster-model://voice/test/whisper/config.json')).resolves.toBe(target)
  })

  test('rejects corrupt bytes without exposing a partial model', async () => {
    const expected = manifest('good')
    const base = await root()
    const store = new VoiceModelStore(
      base,
      async () => new Response('evil', { headers: { 'content-length': '4' } }),
      expected,
    )

    await expect(store.download()).rejects.toThrow('integrity check failed')
    const target = join(base, 'test', 'whisper', expected.revision, 'config.json')
    await expect(stat(target)).rejects.toThrow()
    await expect(stat(`${target}.partial`)).rejects.toThrow()
  })

  test('cancels a download and leaves no promoted file', async () => {
    const expected = manifest('data')
    const base = await root()
    const store = new VoiceModelStore(
      base,
      (_url, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
      expected,
    )
    const download = store.download()
    await vi.waitFor(() => expect(store.status()).resolves.toMatchObject({ state: 'downloading' }))
    store.cancelDownload()
    await expect(download).rejects.toThrow('cancelled')
  })

  test('waits for an active download to stop before deleting its cache', async () => {
    const expected = manifest('data')
    const base = await root()
    const store = new VoiceModelStore(
      base,
      (_url, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
      expected,
    )

    const download = store.download()
    await vi.waitFor(() => expect(store.status()).resolves.toMatchObject({ state: 'downloading' }))
    const cancelled = expect(download).rejects.toThrow('cancelled')
    await store.delete()

    await cancelled
    await expect(store.status()).resolves.toMatchObject({ state: 'missing' })
  })

  test('serves only the exact allowlisted model path', async () => {
    const expected = manifest('data')
    const base = await root()
    const store = new VoiceModelStore(base, async () => new Response('data'), expected)
    await store.download()

    await expect(store.fileForUrl('roster-model://voice/test/whisper/../secret')).resolves.toBeNull()
    await expect(store.fileForUrl('roster-model://other/test/whisper/config.json')).resolves.toBeNull()
  })

  test('encodes manifest file segments without floating the revision', () => {
    const expected = manifest('x', 'folder/a name.json')
    expect(modelUrl(expected.files[0]!, expected)).toBe(
      'https://huggingface.co/test/whisper/resolve/0123456789abcdef/folder/a%20name.json',
    )
  })
})

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
