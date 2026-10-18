import { expect, it, vi } from 'vitest'
import { buildRosterTools } from '../../electron/main/runners/handoffTool'
import { defineTool } from '../../electron/main/runners/toolDefinitions'

function tool(testLocalDesktop?: () => Promise<{ expected: string; observed: string; screenshot: string }>) {
  return buildRosterTools({ listAgents: () => [], openSession: vi.fn(), closeSession: vi.fn(), requestUserDecision: vi.fn(), testLocalDesktop }, 'agent', defineTool).find(t => t.name === 'test_local_desktop')!
}
it('returns verified text and the disposable window image from the confirmed action', async () => {
  const run = vi.fn().mockResolvedValue({ expected: 'abc', observed: 'abc', screenshot: 'data:image/png;base64,aGVsbG8=' })
  const result = await tool(run).handler({} as never, {} as never)
  expect(run).toHaveBeenCalledOnce()
  expect(result.content).toEqual([{ type: 'text', text: 'Local keyboard control verified. Read back: abc' }, { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }])
})
it('reports unavailable or declined tests as tool errors', async () => {
  expect((await tool().handler({} as never, {} as never)).isError).toBe(true)
  expect((await tool(async () => { throw new Error('User declined desktop test.') }).handler({} as never, {} as never)).isError).toBe(true)
})
