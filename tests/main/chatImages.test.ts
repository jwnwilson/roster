import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readChatImage, MAX_CHAT_IMAGE_BYTES } from '@main/images/readChatImage'
import { classifyImageSource, embeddedImageUrl } from '@shared/images'

describe('classifyImageSource', () => {
  test('embedded raster images are used directly', () => {
    expect(classifyImageSource('data:image/png;base64,iVBORw0KGgo=')).toEqual({ kind: 'data' })
    expect(classifyImageSource('data:image/jpeg;base64,/9j/')).toEqual({ kind: 'data' })
  })

  test('embedded SVG and non-image data are refused', () => {
    expect(classifyImageSource('data:image/svg+xml;base64,PHN2Zz4=')).toEqual({
      kind: 'unsupported',
    })
    expect(classifyImageSource('data:text/html;base64,PGI+')).toEqual({ kind: 'unsupported' })
  })

  test('absolute local paths to image files are read by the main process', () => {
    expect(classifyImageSource('/Users/noel/shot.PNG')).toEqual({
      kind: 'local',
      path: '/Users/noel/shot.PNG',
    })
  })

  test('relative paths and non-image files are not loaded', () => {
    expect(classifyImageSource('shot.png')).toEqual({ kind: 'unsupported' })
    expect(classifyImageSource('/Users/noel/notes.txt')).toEqual({ kind: 'unsupported' })
  })

  test('remote images are not fetched, because the CSP forbids them', () => {
    expect(classifyImageSource('https://example.com/a.png')).toEqual({ kind: 'remote' })
  })

  test('an empty or missing source is unsupported', () => {
    expect(classifyImageSource('')).toEqual({ kind: 'unsupported' })
    expect(classifyImageSource(undefined)).toEqual({ kind: 'unsupported' })
  })
})

describe('readChatImage', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'chat-images-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('returns a data URL for an image file', async () => {
    const path = join(dir, 'shot.png')
    await writeFile(path, Buffer.from([1, 2, 3]))

    const url = await readChatImage(path)

    expect(url).toBe(`data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`)
  })

  test('refuses a file whose extension is not an image type', async () => {
    const path = join(dir, 'secrets.txt')
    await writeFile(path, 'hunter2')

    expect(await readChatImage(path)).toBeNull()
  })

  test('refuses a relative path', async () => {
    expect(await readChatImage('shot.png')).toBeNull()
  })

  test('returns null for a missing file rather than throwing', async () => {
    expect(await readChatImage(join(dir, 'gone.png'))).toBeNull()
  })

  test('refuses a directory named like an image', async () => {
    const path = join(dir, 'folder.png')
    await (await import('node:fs/promises')).mkdir(path)

    expect(await readChatImage(path)).toBeNull()
  })

  test('refuses a file over the size cap', async () => {
    const path = join(dir, 'huge.png')
    await writeFile(path, Buffer.alloc(MAX_CHAT_IMAGE_BYTES + 1))

    expect(await readChatImage(path)).toBeNull()
  })
})

describe('embeddedImageUrl', () => {
  test('a supported raster image becomes a data URL', () => {
    expect(embeddedImageUrl('image/png', 'iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(embeddedImageUrl('IMAGE/JPEG', '/9j/')).toBe('data:image/jpeg;base64,/9j/')
  })

  test('SVG, other types, and missing payloads are refused', () => {
    expect(embeddedImageUrl('image/svg+xml', 'PHN2Zz4=')).toBeNull()
    expect(embeddedImageUrl('text/html', 'PGI+')).toBeNull()
    expect(embeddedImageUrl('image/png', '')).toBeNull()
    expect(embeddedImageUrl(undefined, 'iVBORw0KGgo=')).toBeNull()
  })

  test('a payload that is not plain base64 is refused, so it cannot break out of src', () => {
    expect(embeddedImageUrl('image/png', 'AAAA"><script>')).toBeNull()
  })

  test('an image over the size cap is refused', () => {
    const big = 'A'.repeat(Math.ceil((MAX_CHAT_IMAGE_BYTES * 4) / 3) + 8)
    expect(embeddedImageUrl('image/png', big)).toBeNull()
  })
})
