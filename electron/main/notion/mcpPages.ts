import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { NotionMcpTools } from './mcpClient'
import type { NotionPageInfo, NotionPages } from './pages'

/**
 * The hosted Notion MCP tools, as the three page operations Roster needs.
 *
 * These tools are a product, not a stable API: their replies come back as
 * structured content on a good day and as text the rest of the time, and a
 * page's properties arrive in whichever shape the server currently favours.
 * Everything here is therefore written to read what it can and say plainly
 * when it cannot, rather than to trust one shape.
 */
export class NotionMcpPages implements NotionPages {
  constructor(private readonly mcp: NotionMcpTools) {}

  async fetchPage(urlOrId: string): Promise<NotionPageInfo> {
    const body = await this.value(await this.mcp.call('notion-fetch', { id: urlOrId }))
    const properties = asRecord(body['properties']) ?? body

    const pageId = firstString(body, ['id', 'page_id', 'url']) ?? urlOrId
    return {
      pageId: idOf(pageId) ?? urlOrId,
      title: readTitle(body, properties),
      status: readStatus(properties),
    }
  }

  async setStatus(pageId: string, notionStatus: string): Promise<void> {
    await this.value(
      await this.mcp.call('notion-update-page', {
        page_id: pageId,
        command: 'update_properties',
        // Flat values: the hosted tool takes property names to plain option
        // names, not the nested objects the REST API wants.
        properties: { [STATUS_PROPERTY]: notionStatus },
        allow_async: false,
      }),
    )
  }

  async addComment(pageId: string, text: string): Promise<void> {
    await this.value(
      await this.mcp.call('notion-create-comment', {
        page_id: pageId,
        rich_text: [{ text: { content: text } }],
      }),
    )
  }

  /** The reply body, or the reason the call is of no use. */
  private async value(reply: CallToolResult): Promise<Record<string, unknown>> {
    if (reply.isError) throw new Error(message(reply) || 'Notion could not complete that request.')
    const structured = asRecord(reply.structuredContent)
    if (structured) return structured

    const text = message(reply)
    const parsed = parseJson(text)
    if (parsed) return parsed
    if (text.trim() === '') return {}
    return parseText(text)
  }
}

/**
 * The property Roster writes.
 *
 * Notion's own template calls it Status and so does almost every board built
 * from one. A database that named it something else is why the failure is a
 * comment on the task rather than a silent no-op.
 */
const STATUS_PROPERTY = 'Status'

const STATUS_KEY = /^status$/i
const TITLE_KEYS = ['title', 'name']

function readTitle(body: Record<string, unknown>, properties: Record<string, unknown>): string {
  for (const source of [body, properties]) {
    for (const [key, value] of Object.entries(source)) {
      if (!TITLE_KEYS.includes(key.toLowerCase())) continue
      const text = plainText(value)
      if (text !== '') return text
    }
  }
  return ''
}

function readStatus(properties: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(properties)) {
    if (!STATUS_KEY.test(key)) continue
    const text = plainText(value)
    if (text !== '') return text
  }
  return null
}

/**
 * A property value as the option or title text it stands for.
 *
 * Handles the flat string the hosted tools return, and the nested REST
 * shapes — `{status: {name}}`, `{title: [{plain_text}]}` — that still turn up
 * in some replies.
 */
function plainText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(plainText).join('').trim()

  const record = asRecord(value)
  if (!record) return ''
  for (const key of ['name', 'plain_text', 'content']) {
    const inner = record[key]
    if (typeof inner === 'string') return inner.trim()
  }
  for (const key of ['status', 'select', 'title', 'text', 'rich_text']) {
    if (key in record) return plainText(record[key])
  }
  return ''
}

/** `Status: In progress` lines, for a reply that is prose with a list in it. */
function parseText(text: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*[-*]?\s*([A-Za-z][\w ]{0,40}?)\s*[:=]\s*(.+?)\s*$/)
    if (match) properties[match[1] as string] = match[2] as string
  }
  const titled = text.match(/^#\s+(.+)$/m)
  if (titled && !('title' in properties)) properties['title'] = titled[1] as string
  return properties
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return asRecord(JSON.parse(text.slice(start, end + 1)))
  } catch {
    return null
  }
}

function firstString(body: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/** The plain 32-character id out of an id or a URL that contains one. */
function idOf(value: string): string | null {
  const matches = value.match(/[0-9a-f]{32}/gi)
  if (matches && matches.length > 0) return (matches[matches.length - 1] as string).toLowerCase()
  const dashed = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return dashed ? dashed[0].toLowerCase().replaceAll('-', '') : null
}

function message(reply: CallToolResult): string {
  return reply.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
