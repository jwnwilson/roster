import type { NotionProperty } from './mapping'

/**
 * Roster's only outbound HTTP.
 *
 * Everything else the app does is a subprocess it spawned, so this file is
 * the whole network surface and is kept deliberately small: four calls, one
 * queue, one place errors are turned into sentences.
 *
 * Pinned to a Notion API version on purpose. 2025-09-03 split a database into
 * a container holding one or more *data sources*, and moved querying from
 * /v1/databases/{id}/query to /v1/data_sources/{id}/query. That was not
 * backwards compatible, so an unpinned client would break the day Notion
 * moves again.
 */

const API = 'https://api.notion.com/v1'
const VERSION = '2025-09-03'

/** Notion allows roughly three requests a second; this stays under it. */
const GAP_MS = 350
const TIMEOUT_MS = 20_000
const MAX_ATTEMPTS = 4

/** Distinguishable so callers can say something useful rather than "request failed". */
export type NotionFailure = 'auth' | 'access' | 'notFound' | 'rateLimit' | 'network' | 'notion'

export class NotionError extends Error {
  constructor(
    readonly kind: NotionFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'NotionError'
  }
}

export interface NotionPage {
  id: string
  properties: Record<string, unknown>
}

export interface DataSourceRef {
  id: string
  name: string
}

/**
 * A Notion workspace, as far as Roster is concerned.
 *
 * `fetch` is injected so the tests can drive retries and failures without a
 * network — this is the one place in the app where that matters.
 */
export class NotionClient {
  /** Requests run one at a time; the tail of that chain. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** The data sources inside a database. Usually one; Notion allows several. */
  async dataSources(databaseId: string): Promise<DataSourceRef[]> {
    const body = await this.request<{ data_sources?: unknown }>('GET', `/databases/${databaseId}`)
    const sources = Array.isArray(body.data_sources) ? body.data_sources : []

    return sources.flatMap((source) => {
      if (!isRecord(source)) return []
      const id = source['id']
      const name = source['name']
      return typeof id === 'string' ? [{ id, name: typeof name === 'string' ? name : id }] : []
    })
  }

  /** A data source's properties, for working out which is which. */
  async schema(dataSourceId: string): Promise<{ title: string; properties: NotionProperty[] }> {
    const body = await this.request<{ title?: unknown; properties?: unknown }>(
      'GET',
      `/data_sources/${dataSourceId}`,
    )

    return {
      title: plainText(body.title),
      properties: isRecord(body.properties) ? readProperties(body.properties) : [],
    }
  }

  /** Every page in a data source, following Notion's cursor to the end. */
  async pages(dataSourceId: string): Promise<NotionPage[]> {
    const collected: NotionPage[] = []
    let cursor: string | undefined

    do {
      const body = await this.request<{
        results?: unknown
        next_cursor?: unknown
        has_more?: unknown
      }>('POST', `/data_sources/${dataSourceId}/query`, {
        page_size: 100,
        ...(cursor !== undefined ? { start_cursor: cursor } : {}),
      })

      const results = Array.isArray(body.results) ? body.results : []
      for (const page of results) {
        if (isRecord(page) && typeof page['id'] === 'string' && isRecord(page['properties'])) {
          collected.push({ id: page['id'], properties: page['properties'] })
        }
      }

      cursor = body.has_more === true && typeof body.next_cursor === 'string'
        ? body.next_cursor
        : undefined
    } while (cursor !== undefined)

    return collected
  }

  /** Writes the mapped properties onto one page. */
  async updatePage(pageId: string, properties: Record<string, unknown>): Promise<void> {
    await this.request('PATCH', `/pages/${pageId}`, { properties })
  }

  /* ---- transport ------------------------------------------------------- */

  /**
   * One request, queued behind the last, retried when Notion asks for it.
   *
   * Serialised rather than parallel: an import of a few hundred pages would
   * otherwise burst straight through the rate limit on its first breath.
   */
  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const run = this.queue.then(() => this.attempt<T>(method, path, body))
    // The queue must not stop at the first failure, so it tracks completion
    // rather than success.
    this.queue = run.catch(() => undefined)
    return run
  }

  private async attempt<T>(method: string, path: string, body?: unknown): Promise<T> {
    let wait = 1_000

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await this.sleep(GAP_MS)

      const response = await this.send(method, path, body)

      if (response.ok) return (await response.json()) as T

      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === MAX_ATTEMPTS) throw await describe(response)

      // Notion says how long to wait when it is the one throttling.
      const after = Number(response.headers.get('retry-after'))
      await this.sleep(Number.isFinite(after) && after > 0 ? after * 1_000 : wait)
      wait *= 2
    }

    throw new NotionError('notion', 'Notion did not answer after several attempts')
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      return await this.fetchImpl(`${API}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Notion-Version': VERSION,
          'Content-Type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (cause) {
      // A refused connection, DNS, or our own timeout — all "we never got
      // there", which is a different conversation from "Notion said no".
      throw new NotionError(
        'network',
        controller.signal.aborted
          ? 'Notion did not respond in time'
          : `Could not reach Notion: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Notion's error, in words that say what to do about it.
 *
 * 401 and 404 are the two failures anyone actually hits, and they need
 * different advice: one is the token, the other is almost always that the
 * integration was never given access to the database.
 */
async function describe(response: Response): Promise<NotionError> {
  const detail = await messageFrom(response)

  if (response.status === 401) {
    return new NotionError('auth', `Notion rejected the token. ${detail}`.trim(), 401)
  }
  if (response.status === 404) {
    return new NotionError(
      'access',
      'Notion cannot see that database. Open it in Notion, and use ••• → Connect to, or the ' +
        'integration’s Access tab, to give this integration access.',
      404,
    )
  }
  if (response.status === 429) {
    return new NotionError('rateLimit', 'Notion is rate limiting this integration.', 429)
  }

  return new NotionError('notion', `Notion returned ${response.status}. ${detail}`.trim(), response.status)
}

async function messageFrom(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    return isRecord(body) && typeof body['message'] === 'string' ? body['message'] : ''
  } catch {
    return ''
  }
}

/** The schema's properties, flattened to what the mapping needs. */
function readProperties(properties: Record<string, unknown>): NotionProperty[] {
  return Object.entries(properties).flatMap(([name, value]) => {
    if (!isRecord(value) || typeof value['type'] !== 'string') return []
    const type = value['type']

    return [{ name, type, options: readOptions(value[type]) }]
  })
}

function readOptions(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value['options'])) return []

  return value['options'].flatMap((option) =>
    isRecord(option) && typeof option['name'] === 'string' ? [option['name']] : [],
  )
}

/** Notion titles are arrays of rich-text parts, even when there is one. */
function plainText(value: unknown): string {
  if (!Array.isArray(value)) return ''

  return value
    .map((part) => (isRecord(part) && typeof part['plain_text'] === 'string' ? part['plain_text'] : ''))
    .join('')
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The database id out of whatever someone pasted.
 *
 * People paste the URL far more often than the id, and Notion writes ids both
 * with and without dashes. Both are accepted; anything else is refused rather
 * than sent and 404'd.
 */
export function databaseIdFrom(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed === '') return null

  // The last 32 hex characters of a URL are the id; a bare id is just those.
  const matches = trimmed.match(/[0-9a-f]{32}/gi)
  if (matches && matches.length > 0) return dashed(matches[matches.length - 1] as string)

  const dashedId = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return dashedId ? dashedId[0].toLowerCase() : null
}

function dashed(id: string): string {
  const lower = id.toLowerCase()
  return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`
}
