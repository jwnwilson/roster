import { describe, expect, test, vi } from 'vitest'
import { NotionMcpBoardClient } from '@main/notion/mcpBoardClient'
import type { NotionMcpTools } from '@main/notion/mcpClient'

function reply(value: Record<string, unknown>) {
  return { content: [], structuredContent: value }
}

describe('Notion MCP board adapter', () => {
  test('uses hosted MCP fetch and query tools for the importer', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce(reply({ data_sources: [{ id: 'source', name: 'Tasks' }] }))
      .mockResolvedValueOnce(reply({ title: 'Tasks', properties: { Name: { type: 'title' }, Status: { type: 'status', status: { options: [{ name: 'Todo' }] } } } }))
      .mockResolvedValueOnce(reply({ results: [{ id: 'page', properties: { Name: [{ plain_text: 'Ship it' }] } }] }))
    const client = new NotionMcpBoardClient({ tools: vi.fn(), call } as unknown as NotionMcpTools)

    await expect(client.dataSources('database')).resolves.toEqual([{ id: 'source', name: 'Tasks' }])
    await expect(client.schema('source')).resolves.toEqual({
      title: 'Tasks',
      properties: [
        { name: 'Name', type: 'title', options: [] },
        { name: 'Status', type: 'status', options: ['Todo'] },
      ],
    })
    await expect(client.pages('source')).resolves.toEqual([{ id: 'page', properties: { Name: [{ plain_text: 'Ship it' }] } }])
    expect(call).toHaveBeenNthCalledWith(3, 'notion-query-data-sources', {
      mode: 'rows', data_source_url: 'collection://source', limit: 100,
    })
  })

  test('updates a page through the MCP tool and surfaces unreadable responses', async () => {
    const call = vi.fn().mockResolvedValue(reply({ ok: true }))
    const client = new NotionMcpBoardClient({ tools: vi.fn(), call } as unknown as NotionMcpTools)
    await client.updatePage('page', { Status: { status: { name: 'Done' } } })
    expect(call).toHaveBeenCalledWith('notion-update-page', expect.objectContaining({ page_id: 'page', allow_async: false }))

    call.mockResolvedValueOnce({ content: [{ type: 'text', text: 'No structured data' }] })
    await expect(client.dataSources('database')).rejects.toThrow('No structured data')
  })
})
