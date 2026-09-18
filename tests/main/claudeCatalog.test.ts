import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { canonicalModelId, catalogModelIds, claudeCatalogDir } from '@main/runners/claudeCatalog'

const CAPTURED = join(import.meta.dirname, 'fixtures/claude/model-catalog-cc.json')

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'roster-catalog-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A catalogue file shaped like the CLI's, with whatever models are asked for. */
async function catalogue(
  name: string,
  models: unknown[],
  extra: Record<string, unknown> = {},
): Promise<void> {
  await writeFile(
    join(dir, name),
    JSON.stringify({
      version: 2,
      fetchedAt: 1_789_724_811_158,
      staleAt: 1_789_728_354_611,
      catalog: { surface: 'cc', config: { id: 'cc', models } },
      ...extra,
    }),
    'utf8',
  )
}

describe('catalogModelIds — the list the user’s own CLI is offering', () => {
  test('reads every model out of a catalogue the CLI really wrote', async () => {
    await copyFile(CAPTURED, join(dir, 'a2a6615c-aec1-4e60-be65-2e70107f3e20-cbed6ebb8664-cc.json'))

    expect(await catalogModelIds(dir)).toEqual([
      'claude-opus-5',
      'claude-fable-5-1',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ])
  })

  test('offers a model Roster has never heard of, which is the point', async () => {
    await catalogue('one-cc.json', [{ id: 'claude-opus-6' }])

    expect(await catalogModelIds(dir)).toContain('claude-opus-6')
  })

  test('trims a dated snapshot to the slug Roster’s tables key on', async () => {
    await catalogue('one-cc.json', [{ id: 'claude-haiku-4-5-20251001' }])

    expect(await catalogModelIds(dir)).toEqual(['claude-haiku-4-5'])
  })

  test('lists a model once when the catalogue names it both dated and not', async () => {
    await catalogue('one-cc.json', [
      { id: 'claude-haiku-4-5' },
      { id: 'claude-haiku-4-5-20251001' },
    ])

    expect(await catalogModelIds(dir)).toEqual(['claude-haiku-4-5'])
  })

  test('prefers the most recently fetched catalogue when several are cached', async () => {
    await catalogue('old-cc.json', [{ id: 'claude-opus-4-9' }], { fetchedAt: 1 })
    await catalogue('new-cc.json', [{ id: 'claude-opus-5' }], { fetchedAt: 2 })

    expect(await catalogModelIds(dir)).toEqual(['claude-opus-5'])
  })

  test('ignores a catalogue written for another surface than Claude Code', async () => {
    await writeFile(
      join(dir, 'web.json'),
      JSON.stringify({ fetchedAt: 9, catalog: { surface: 'web', config: { models: [{ id: 'x' }] } } }),
      'utf8',
    )

    expect(await catalogModelIds(dir)).toEqual([])
  })

  test('uses a stale catalogue rather than nothing, since it is still real', async () => {
    await catalogue('one-cc.json', [{ id: 'claude-opus-5' }], { staleAt: 1 })

    expect(await catalogModelIds(dir)).toEqual(['claude-opus-5'])
  })

  test('returns nothing when the cache directory does not exist', async () => {
    expect(await catalogModelIds(join(dir, 'nowhere'))).toEqual([])
  })

  test('returns nothing when the directory holds no catalogue', async () => {
    await mkdir(join(dir, 'empty'))

    expect(await catalogModelIds(join(dir, 'empty'))).toEqual([])
  })

  test('returns nothing when the file is not JSON', async () => {
    await writeFile(join(dir, 'broken-cc.json'), 'half a file', 'utf8')

    expect(await catalogModelIds(dir)).toEqual([])
  })

  test('returns nothing when the JSON is not shaped like a catalogue', async () => {
    await writeFile(join(dir, 'odd-cc.json'), JSON.stringify({ catalog: 'soon' }), 'utf8')

    expect(await catalogModelIds(dir)).toEqual([])
  })

  test('returns nothing when the catalogue lists no models', async () => {
    await catalogue('empty-cc.json', [])

    expect(await catalogModelIds(dir)).toEqual([])
  })

  test('skips entries with no usable id rather than offering a blank one', async () => {
    await catalogue('one-cc.json', [{ id: '' }, { name: 'Opus 5' }, 7, { id: 'claude-opus-5' }])

    expect(await catalogModelIds(dir)).toEqual(['claude-opus-5'])
  })

  test('falls back to a readable catalogue when another one is corrupt', async () => {
    await writeFile(join(dir, 'broken-cc.json'), '{', 'utf8')
    await catalogue('good-cc.json', [{ id: 'claude-opus-5' }])

    expect(await catalogModelIds(dir)).toEqual(['claude-opus-5'])
  })

  test('ignores a file that is not JSON at all', async () => {
    await writeFile(join(dir, 'notes.txt'), 'hello', 'utf8')
    await catalogue('good-cc.json', [{ id: 'claude-opus-5' }])

    expect(await catalogModelIds(dir)).toEqual(['claude-opus-5'])
  })
})

describe('claudeCatalogDir', () => {
  test('points at the cache the CLI writes, not at Roster’s own home', () => {
    expect(claudeCatalogDir()).toBe(join(homedir(), '.claude', 'cache', 'model-catalog'))
  })
})

describe('canonicalModelId', () => {
  test('drops the date from a snapshot slug', () => {
    expect(canonicalModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
  })

  test('leaves an undated slug alone', () => {
    expect(canonicalModelId('claude-fable-5-1')).toBe('claude-fable-5-1')
  })

  test('leaves a version number that is not a date alone', () => {
    expect(canonicalModelId('claude-opus-5')).toBe('claude-opus-5')
  })
})
