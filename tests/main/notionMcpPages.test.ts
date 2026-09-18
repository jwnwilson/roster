import { describe, expect, test, vi } from 'vitest'
import { NotionMcpPages } from '@main/notion/mcpPages'
import type { NotionMcpTools } from '@main/notion/mcpClient'

const PAGE_ID = '1f8d872b594c80a4b2f400370af2b13f'

function toolsReturning(reply: unknown) {
  const call = vi.fn(async () => reply)
  return { pages: new NotionMcpPages({ tools: vi.fn(), call } as unknown as NotionMcpTools), call }
}

function structured(value: Record<string, unknown>) {
  return { content: [], structuredContent: value }
}

function text(value: string) {
  return { content: [{ type: 'text', text: value }] }
}

describe('reading a Notion page through the hosted MCP tools', () => {
  test('reads the title and status out of a structured reply', async () => {
    const { pages, call } = toolsReturning(
      structured({ id: PAGE_ID, properties: { Name: 'Ship it', Status: 'In progress' } }),
    )

    await expect(pages.fetchPage(PAGE_ID)).resolves.toEqual({
      pageId: PAGE_ID,
      title: 'Ship it',
      status: 'In progress',
    })
    expect(call).toHaveBeenCalledWith('notion-fetch', { id: PAGE_ID })
  })

  test('reads the nested property shapes the API also returns', async () => {
    const { pages } = toolsReturning(
      structured({
        id: PAGE_ID,
        properties: { Name: { title: [{ plain_text: 'Ship it' }] }, Status: { status: { name: 'Done' } } },
      }),
    )

    await expect(pages.fetchPage(PAGE_ID)).resolves.toMatchObject({ title: 'Ship it', status: 'Done' })
  })

  test('reads a reply that arrives as JSON in text', async () => {
    const { pages } = toolsReturning(
      text(`Here is the page:\n{"id":"${PAGE_ID}","properties":{"Title":"Ship it","Status":"Done"}}`),
    )

    await expect(pages.fetchPage(PAGE_ID)).resolves.toMatchObject({ title: 'Ship it', status: 'Done' })
  })

  test('reads a reply that arrives as prose with a property list', async () => {
    const { pages } = toolsReturning(text(`# Ship it\n\n- Status: In review\n- Priority: High\n`))

    await expect(pages.fetchPage(PAGE_ID)).resolves.toMatchObject({ title: 'Ship it', status: 'In review' })
  })

  test('takes the page id out of a URL reply', async () => {
    const { pages } = toolsReturning(structured({ url: `https://www.notion.so/Ship-it-${PAGE_ID}`, title: 'Ship it' }))

    await expect(pages.fetchPage(`https://www.notion.so/Ship-it-${PAGE_ID}`)).resolves.toMatchObject({
      pageId: PAGE_ID,
      status: null,
    })
  })

  test('refuses a reply the tool marked as an error', async () => {
    const { pages } = toolsReturning({ ...text('No access to that page'), isError: true })

    await expect(pages.fetchPage(PAGE_ID)).rejects.toThrow('No access to that page')
  })
})

describe('writing to a Notion page', () => {
  test('sets the status as a flat property value', async () => {
    const { pages, call } = toolsReturning(structured({ ok: true }))

    await pages.setStatus(PAGE_ID, 'Done')

    expect(call).toHaveBeenCalledWith('notion-update-page', {
      page_id: PAGE_ID,
      command: 'update_properties',
      properties: { Status: 'Done' },
      allow_async: false,
    })
  })

  test('adds a comment', async () => {
    const { pages, call } = toolsReturning(structured({ ok: true }))

    await pages.addComment(PAGE_ID, 'You: Blocked on review')

    expect(call).toHaveBeenCalledWith('notion-create-comment', {
      page_id: PAGE_ID,
      rich_text: [{ text: { content: 'You: Blocked on review' } }],
    })
  })

  test('surfaces a refusal so the task thread can carry it', async () => {
    const { pages } = toolsReturning({ ...text('Status is not a property of that page'), isError: true })

    await expect(pages.setStatus(PAGE_ID, 'Done')).rejects.toThrow('Status is not a property')
  })
})
