import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { NotionBoardClient, DataSourceRef, NotionPage } from './client'
import type { NotionProperty } from './mapping'
import type { NotionMcpTools } from './mcpClient'

/**
 * Board adapter over the hosted MCP tools. The import mapping remains Roster's
 * own concern; only the Notion transport changed.
 */
export class NotionMcpBoardClient implements NotionBoardClient {
  constructor(private readonly mcp: NotionMcpTools) {}

  async dataSources(databaseId: string): Promise<DataSourceRef[]> {
    const body = await this.value(await this.mcp.call('notion-fetch', { id: databaseId }))
    const sources = arrayAt(body, 'data_sources')
    return sources.flatMap((source) => {
      const record = asRecord(source)
      const id = record?.['id']
      const name = record?.['name']
      return typeof id === 'string' ? [{ id, name: typeof name === 'string' ? name : id }] : []
    })
  }

  async schema(dataSourceId: string): Promise<{ title: string; properties: NotionProperty[] }> {
    const body = await this.value(await this.mcp.call('notion-fetch', { id: dataSourceId }))
    const properties = asRecord(body['properties']) ?? {}
    return { title: textAt(body, 'title'), properties: readProperties(properties) }
  }

  async pages(dataSourceId: string): Promise<NotionPage[]> {
    const body = await this.value(
      await this.mcp.call('notion-query-data-sources', {
        mode: 'rows',
        data_source_url: `collection://${dataSourceId}`,
        limit: 100,
      }),
    )
    const results = arrayAt(body, 'results')
    return results.flatMap((page) => {
      const record = asRecord(page)
      const id = record?.['id']
      const properties = asRecord(record?.['properties']) ?? record ?? {}
      return typeof id === 'string' ? [{ id, properties }] : []
    })
  }

  async updatePage(pageId: string, properties: Record<string, unknown>): Promise<void> {
    await this.value(
      await this.mcp.call('notion-update-page', {
        page_id: pageId,
        command: 'update_properties',
        properties,
        allow_async: false,
      }),
    )
  }

  private async value(reply: CallToolResult): Promise<Record<string, unknown>> {
    if (reply.isError) throw new Error(message(reply) || 'Notion could not complete that request.')
    if (asRecord(reply.structuredContent)) return asRecord(reply.structuredContent)!
    const content = reply.content.find((item) => item.type === 'text')
    if (content?.type === 'text') {
      try {
        const parsed: unknown = JSON.parse(content.text)
        if (asRecord(parsed)) return asRecord(parsed)!
      } catch {
        // MCP servers are allowed to return prose-only content. Surface that
        // instead of silently importing no rows.
      }
    }
    throw new Error(message(reply) || 'Notion returned a response Roster could not read.')
  }
}

function readProperties(properties: Record<string, unknown>): NotionProperty[] {
  return Object.entries(properties).flatMap(([name, value]) => {
    const record = asRecord(value)
    const type = record?.['type']
    if (typeof type !== 'string') return []
    const detail = asRecord(record?.[type])
    const options = arrayAt(detail ?? {}, 'options').flatMap((option) => {
      const item = asRecord(option)
      return typeof item?.['name'] === 'string' ? [item['name']] : []
    })
    return [{ name, type, options }]
  })
}

function message(reply: CallToolResult): string {
  return reply.content.filter((item) => item.type === 'text').map((item) => item.text).join(' ')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function arrayAt(value: Record<string, unknown>, key: string): unknown[] {
  const found = value[key]
  return Array.isArray(found) ? found : []
}

function textAt(value: Record<string, unknown>, key: string): string {
  const found = value[key]
  if (typeof found === 'string') return found
  if (Array.isArray(found)) {
    return found.map((part) => (typeof asRecord(part)?.['plain_text'] === 'string' ? asRecord(part)!['plain_text'] : '')).join('')
  }
  return ''
}
