import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where the Claude CLI caches the catalogue behind its own model picker. */
export function claudeCatalogDir(): string {
  return join(homedir(), '.claude', 'cache', 'model-catalog')
}

/** The catalogue Claude Code is the surface for; other clients cache their own. */
const CLAUDE_CODE_SURFACE = 'cc'

interface Catalogue {
  /** Epoch ms, so the freshest of several cached files wins. */
  fetchedAt: number
  ids: string[]
}

/**
 * The model ids the user's own Claude CLI is currently offering.
 *
 * Empty when nothing readable is there, which the caller reads as "use the
 * built-in list" — a bad cache file must never leave the picker with nothing.
 *
 * `staleAt` is deliberately not consulted. The CLI refreshes this about
 * hourly, so a stale catalogue is at worst a few hours behind what Anthropic
 * offers, where the built-in list is however far behind Roster's last release.
 * Stale and real beats fresh and frozen.
 */
export async function catalogModelIds(dir = claudeCatalogDir()): Promise<string[]> {
  const names = await readdir(dir).catch(() => [])

  const catalogues = await Promise.all(
    names.filter((name) => name.endsWith('.json')).map((name) => readCatalogue(join(dir, name))),
  )

  const newest = catalogues
    .filter((catalogue): catalogue is Catalogue => catalogue !== null)
    .sort((a, b) => b.fetchedAt - a.fetchedAt)[0]

  return newest?.ids ?? []
}

/**
 * Dated snapshots answer to their family's slug.
 *
 * The catalogue names Haiku `claude-haiku-4-5-20251001` while Roster's price
 * table and CONTEXT_WINDOWS both key on `claude-haiku-4-5`. The undated slug
 * is an alias the SDK accepts, so trimming the date is what keeps a
 * catalogue-driven list hitting both lookups instead of silently missing
 * them. Same reasoning as modelAlias in costs/codex.ts, different shape:
 * Anthropic dates a slug `-YYYYMMDD` where OpenAI writes `-YYYY-MM-DD`.
 */
export function canonicalModelId(id: string): string {
  return id.replace(/-\d{8}$/, '')
}

interface CatalogueFile {
  fetchedAt?: unknown
  catalog?: { surface?: unknown; config?: { models?: unknown } }
}

async function readCatalogue(path: string): Promise<Catalogue | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as CatalogueFile
    if (parsed?.catalog?.surface !== CLAUDE_CODE_SURFACE) return null

    const models = parsed.catalog.config?.models
    if (!Array.isArray(models)) return null

    const ids = [...new Set(models.map(modelId).filter(isUsable).map(canonicalModelId))]
    if (ids.length === 0) return null

    return { fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0, ids }
  } catch {
    return null
  }
}

function modelId(model: unknown): unknown {
  return typeof model === 'object' && model !== null ? (model as { id?: unknown }).id : null
}

function isUsable(id: unknown): id is string {
  return typeof id === 'string' && id !== ''
}
