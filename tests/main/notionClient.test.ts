import { describe, expect, test, vi } from 'vitest'
import { NotionClient, NotionError, databaseIdFrom } from '@main/notion/client'

/** A Response without a network. */
function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** Answers each call with the next reply, and records what was asked. */
function stub(...replies: Response[]) {
  const calls: { url: string; init: RequestInit }[] = []
  let next = 0

  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const response = replies[Math.min(next, replies.length - 1)]
    next += 1
    return response as Response
  })

  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, count: () => next }
}

/** No real waiting; the tests are about what is sent, not how long it took. */
const instant = async () => {}

function clientOf(fetchImpl: typeof fetch) {
  return new NotionClient('ntn_test', fetchImpl, instant)
}

/** The NotionError a call throws, or a failure saying it did not throw. */
async function failure(work: Promise<unknown>): Promise<NotionError> {
  try {
    await work
  } catch (cause) {
    return cause as NotionError
  }
  throw new Error('expected the call to fail, and it did not')
}

describe('what the client sends', () => {
  test('carries the token and a pinned API version', async () => {
    const { fetchImpl, calls } = stub(reply(200, { data_sources: [] }))

    await clientOf(fetchImpl).dataSources('db-1')

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer ntn_test')
    // Pinned: 2025-09-03 is the version that introduced data sources, and an
    // unpinned client would break the day Notion moves again.
    expect(headers['Notion-Version']).toBe('2025-09-03')
  })

  test('queries the data source, not the database', async () => {
    const { fetchImpl, calls } = stub(reply(200, { results: [], has_more: false }))

    await clientOf(fetchImpl).pages('ds-1')

    // /v1/databases/{id}/query was removed in 2025-09-03.
    expect(calls[0]?.url).toBe('https://api.notion.com/v1/data_sources/ds-1/query')
    expect(calls[0]?.init.method).toBe('POST')
  })
})

describe('reading a schema', () => {
  test('flattens properties to a name, a type and its options', async () => {
    const { fetchImpl } = stub(
      reply(200, {
        title: [{ plain_text: 'Engineering tasks' }],
        properties: {
          Name: { type: 'title', title: {} },
          Status: {
            type: 'status',
            status: { options: [{ name: 'To Do' }, { name: 'Done' }] },
          },
        },
      }),
    )

    const schema = await clientOf(fetchImpl).schema('ds-1')

    expect(schema.title).toBe('Engineering tasks')
    expect(schema.properties).toEqual([
      { name: 'Name', type: 'title', options: [] },
      { name: 'Status', type: 'status', options: ['To Do', 'Done'] },
    ])
  })
})

describe('paging', () => {
  test('follows the cursor until Notion runs out', async () => {
    const { fetchImpl, calls, count } = stub(
      reply(200, {
        results: [{ id: 'p1', properties: {} }],
        has_more: true,
        next_cursor: 'cursor-2',
      }),
      reply(200, { results: [{ id: 'p2', properties: {} }], has_more: false }),
    )

    const pages = await clientOf(fetchImpl).pages('ds-1')

    expect(pages.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(count()).toBe(2)
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({ start_cursor: 'cursor-2' })
  })

  test('drops a result that is not a page rather than importing a blank', async () => {
    const { fetchImpl } = stub(
      reply(200, { results: [{ id: 'p1', properties: {} }, { nonsense: true }], has_more: false }),
    )

    expect(await clientOf(fetchImpl).pages('ds-1')).toHaveLength(1)
  })
})

describe('when Notion says no', () => {
  test('a bad token is reported as the token', async () => {
    const { fetchImpl } = stub(reply(401, { message: 'API token is invalid.' }))

    const error = await failure(clientOf(fetchImpl).dataSources('db-1'))

    expect(error.kind).toBe('auth')
    expect(error.message).toContain('rejected the token')
  })

  test('a 404 explains that the integration was never given access', async () => {
    const { fetchImpl } = stub(reply(404, { message: 'Could not find database.' }))

    const error = await failure(clientOf(fetchImpl).dataSources('db-1'))

    // This is the failure everyone hits first, and "not found" is the wrong
    // thing to say about a database that plainly exists.
    expect(error.kind).toBe('access')
    expect(error.message).toContain('Connect to')
  })

  test('anything else carries the status through', async () => {
    const { fetchImpl } = stub(reply(400, { message: 'body failed validation' }))

    const error = await failure(clientOf(fetchImpl).dataSources('db-1'))

    expect(error.kind).toBe('notion')
    expect(error.message).toContain('400')
    expect(error.message).toContain('body failed validation')
  })

  test('a network failure is not confused with a refusal', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch

    const error = await failure(clientOf(fetchImpl).dataSources('db-1'))

    expect(error.kind).toBe('network')
    expect(error.message).toContain('Could not reach Notion')
  })
})

describe('retrying', () => {
  test('waits out a rate limit and carries on', async () => {
    const { fetchImpl, count } = stub(
      reply(429, { message: 'rate limited' }, { 'retry-after': '1' }),
      reply(200, { data_sources: [{ id: 'ds-1', name: 'Tasks' }] }),
    )

    const sources = await clientOf(fetchImpl).dataSources('db-1')

    expect(sources).toEqual([{ id: 'ds-1', name: 'Tasks' }])
    expect(count()).toBe(2)
  })

  test('retries a server error', async () => {
    const { fetchImpl, count } = stub(reply(502, {}), reply(200, { data_sources: [] }))

    await clientOf(fetchImpl).dataSources('db-1')

    expect(count()).toBe(2)
  })

  test('gives up rather than retrying forever', async () => {
    const { fetchImpl, count } = stub(reply(500, { message: 'boom' }))

    await expect(clientOf(fetchImpl).dataSources('db-1')).rejects.toThrow()
    expect(count()).toBe(4)
  })

  test('does not retry something retrying cannot fix', async () => {
    const { fetchImpl, count } = stub(reply(401, { message: 'nope' }))

    await expect(clientOf(fetchImpl).dataSources('db-1')).rejects.toThrow()
    expect(count()).toBe(1)
  })
})

describe('requests are serialised', () => {
  test('a failure does not wedge everything queued behind it', async () => {
    const { fetchImpl } = stub(reply(401, { message: 'nope' }), reply(200, { data_sources: [] }))
    const client = clientOf(fetchImpl)

    await expect(client.dataSources('db-1')).rejects.toThrow()

    // The queue tracks completion, not success — one bad request must not
    // stop the next one from ever running.
    await expect(client.dataSources('db-2')).resolves.toEqual([])
  })
})

describe('databaseIdFrom', () => {
  test('takes the id out of a pasted Notion URL', () => {
    expect(
      databaseIdFrom('https://www.notion.so/myteam/2f1a4b6c8d9e4f0a9b1c2d3e4f5a6b7c?v=abc'),
    ).toBe('2f1a4b6c-8d9e-4f0a-9b1c-2d3e4f5a6b7c')
  })

  test('accepts a bare id, dashed or not', () => {
    expect(databaseIdFrom('2f1a4b6c8d9e4f0a9b1c2d3e4f5a6b7c')).toBe(
      '2f1a4b6c-8d9e-4f0a-9b1c-2d3e4f5a6b7c',
    )
    expect(databaseIdFrom('2f1a4b6c-8d9e-4f0a-9b1c-2d3e4f5a6b7c')).toBe(
      '2f1a4b6c-8d9e-4f0a-9b1c-2d3e4f5a6b7c',
    )
  })

  test('refuses something that is not an id, rather than sending it and getting a 404', () => {
    expect(databaseIdFrom('')).toBeNull()
    expect(databaseIdFrom('   ')).toBeNull()
    expect(databaseIdFrom('https://notion.so/myteam/Tasks')).toBeNull()
  })
})
