import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Agent } from '@shared/types'
import type { NotionConnection } from '@shared/notion'
import { openDatabase, type Db } from '@main/db'
import { TaskStore } from '@main/store/tasks'
import { NotionStore } from '@main/store/notion'
import { detectMapping } from '@main/notion/mapping'
import { NotionPush, importConnection } from '@main/notion/sync'
import type { NotionClient } from '@main/notion/client'

const AGENTS = [
  { id: 'debugging', name: 'Debugging Agent' },
  { id: 'review', name: 'Review Agent' },
] as Agent[]

const MAPPING = detectMapping([
  { name: 'Name', type: 'title', options: [] },
  { name: 'Status', type: 'status', options: ['Backlog', 'To Do', 'In progress', 'Done'] },
  { name: 'Priority', type: 'select', options: ['Urgent', 'High', 'Medium', 'Low'] },
  { name: 'Owner', type: 'people', options: [] },
])

const CONNECTION: NotionConnection = {
  id: 'c1',
  name: 'Engineering tasks',
  databaseId: 'db-1',
  dataSourceId: 'ds-1',
  mapping: MAPPING,
  projectId: null,
  createdAt: 0,
}

/** A page as the query endpoint returns it. */
function page(id: string, title: string, extra: Record<string, unknown> = {}) {
  return { id, properties: { Name: { title: [{ plain_text: title }] }, ...extra } }
}

/** A client that answers with these pages and records what was written. */
function fakeClient(pages: ReturnType<typeof page>[]) {
  const updates: { pageId: string; properties: Record<string, unknown> }[] = []

  const client = {
    pages: vi.fn(async () => pages),
    updatePage: vi.fn(async (pageId: string, properties: Record<string, unknown>) => {
      updates.push({ pageId, properties })
    }),
  }

  return { client: client as unknown as NotionClient, updates, spy: client }
}

let db: Db
let tasks: TaskStore
let connections: NotionStore

beforeEach(() => {
  db = openDatabase(':memory:')
  tasks = new TaskStore(db, (id) => AGENTS.find((a) => a.id === id)?.name ?? null)
  connections = new NotionStore(db)
})

describe('importing', () => {
  test('puts every page on the board', async () => {
    const { client } = fakeClient([
      page('p1', 'Fix the pool leak', { Status: { status: { name: 'In progress' } } }),
      page('p2', 'Write the ADR', { Priority: { select: { name: 'Low' } } }),
    ])

    const summary = await importConnection(client, CONNECTION, tasks, () => AGENTS)

    expect(summary).toMatchObject({ created: 2, updated: 0, skipped: 0 })
    expect(tasks.findAll().map((t) => t.title)).toEqual(['Fix the pool leak', 'Write the ADR'])
    expect(tasks.findAll()[0]?.status).toBe('in_progress')
    expect(tasks.findAll()[1]?.priority).toBe('low')
  })

  test('importing twice updates rather than duplicating', async () => {
    const first = fakeClient([page('p1', 'Fix the pool leak')])
    await importConnection(first.client, CONNECTION, tasks, () => AGENTS)

    const second = fakeClient([
      page('p1', 'Fix the pool leak', { Status: { status: { name: 'Done' } } }),
    ])
    const summary = await importConnection(second.client, CONNECTION, tasks, () => AGENTS)

    expect(summary).toMatchObject({ created: 0, updated: 1 })
    expect(tasks.findAll()).toHaveLength(1)
    expect(tasks.findAll()[0]?.status).toBe('done')
  })

  test('a re-import writes History, so the board says where the change came from', async () => {
    const first = fakeClient([page('p1', 'Fix it')])
    await importConnection(first.client, CONNECTION, tasks, () => AGENTS)
    const id = tasks.findAll()[0]?.id as string

    const second = fakeClient([page('p1', 'Fix it', { Status: { status: { name: 'Done' } } })])
    await importConnection(second.client, CONNECTION, tasks, () => AGENTS)

    expect(tasks.comments(id).map((c) => c.text)).toContain('Notion moved this to Done.')
  })

  test('skips a page with no title rather than making a blank card', async () => {
    const { client } = fakeClient([
      { id: 'p1', properties: { Name: { title: [] } } },
      page('p2', 'A real one'),
    ])

    const summary = await importConnection(client, CONNECTION, tasks, () => AGENTS)

    expect(summary).toMatchObject({ created: 1, skipped: 1 })
  })

  test('matches a Notion person to an agent by name', async () => {
    const { client } = fakeClient([
      page('p1', 'Fix it', { Owner: { people: [{ name: 'Debugging Agent' }] } }),
    ])

    await importConnection(client, CONNECTION, tasks, () => AGENTS)

    expect(tasks.findAll()[0]?.assigneeId).toBe('debugging')
  })

  test('leaves the assignee empty when nobody on the roster matches', async () => {
    const { client } = fakeClient([
      page('p1', 'Fix it', { Owner: { people: [{ name: 'Someone Else' }] } }),
    ])

    await importConnection(client, CONNECTION, tasks, () => AGENTS)

    expect(tasks.findAll()[0]?.assigneeId).toBeNull()
  })

  test('files the import under the connection project', async () => {
    const { client } = fakeClient([page('p1', 'Fix it')])
    db.prepare(
      "INSERT INTO projects (id, name, color, description, created_at)" +
        " VALUES ('p-1', 'API', '#fff', '', 0)",
    ).run()

    await importConnection(client, { ...CONNECTION, projectId: 'p-1' }, tasks, () => AGENTS)

    expect(tasks.findAll()[0]?.projectId).toBe('p-1')
  })

  test('a page in a column nothing maps to lands in the backlog', async () => {
    const { client } = fakeClient([
      page('p1', 'Blocked on legal', { Status: { status: { name: 'Awaiting legal' } } }),
    ])

    await importConnection(client, CONNECTION, tasks, () => AGENTS)

    expect(tasks.findAll()[0]?.status).toBe('backlog')
  })

  test('reports progress, so a big import is not a frozen window', async () => {
    const { client } = fakeClient([page('p1', 'a'), page('p2', 'b'), page('p3', 'c')])
    const seen: string[] = []

    await importConnection(client, CONNECTION, tasks, () => AGENTS, (done, total) =>
      seen.push(`${done}/${total}`),
    )

    expect(seen).toEqual(['1/3', '2/3', '3/3'])
  })
})

describe('pushing back', () => {
  /** A push with no waiting, so the debounce does not slow the tests. */
  function pushOf(client: NotionClient | null) {
    return new NotionPush(tasks, connections, () => AGENTS, () => client, 0)
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

  beforeEach(() => {
    connections.create({
      name: 'Engineering tasks',
      databaseId: 'db-1',
      dataSourceId: 'ds-1',
      mapping: MAPPING,
    })
  })

  test('writes a moved task onto its Notion page', async () => {
    const { client, updates } = fakeClient([])
    const task = tasks.create({ title: 'Fix it', notionPageId: 'page-1' })
    tasks.apply(task.id, { field: 'status', value: 'done' }, { name: 'You', tone: 'you' })

    pushOf(client).taskChanged(task.id)
    await settle()

    expect(updates).toEqual([
      {
        pageId: 'page-1',
        properties: {
          Status: { status: { name: 'Done' } },
          Priority: { select: { name: 'Medium' } },
        },
      },
    ])
  })

  test('says nothing about a task that did not come from Notion', async () => {
    const { client, updates } = fakeClient([])
    const task = tasks.create({ title: 'Made here' })

    pushOf(client).taskChanged(task.id)
    await settle()

    expect(updates).toEqual([])
  })

  test('three moves in a row are one write', async () => {
    const { client, updates } = fakeClient([])
    const task = tasks.create({ title: 'Fix it', notionPageId: 'page-1' })
    const push = pushOf(client)

    // Dragging a card across the board should not be three round trips.
    push.taskChanged(task.id)
    push.taskChanged(task.id)
    push.taskChanged(task.id)
    await settle()

    expect(updates).toHaveLength(1)
  })

  test('an import does not immediately push back what it just pulled', async () => {
    const { client, updates } = fakeClient([page('p1', 'Fix it')])
    const push = pushOf(client)

    await push.duringImport(async () => {
      await importConnection(client, CONNECTION, tasks, () => AGENTS)
      // Whatever the import wrote would otherwise be queued straight back out.
      for (const task of tasks.findAll()) push.taskChanged(task.id)
    })
    await settle()

    expect(updates).toEqual([])
  })

  test('pushing resumes once the import is over', async () => {
    const { client, updates } = fakeClient([])
    const push = pushOf(client)
    await push.duringImport(async () => {})

    const task = tasks.create({ title: 'Fix it', notionPageId: 'page-1' })
    push.taskChanged(task.id)
    await settle()

    expect(updates).toHaveLength(1)
  })

  test('a failure is written where someone looking at the task will find it', async () => {
    const client = {
      pages: vi.fn(),
      updatePage: vi.fn(async () => {
        throw new Error('Notion is having a day')
      }),
    } as unknown as NotionClient

    const task = tasks.create({ title: 'Fix it', notionPageId: 'page-1' })
    pushOf(client).taskChanged(task.id)
    await settle()

    // There is no notification system to raise this in, and silence would
    // leave Notion quietly wrong.
    expect(tasks.comments(task.id).map((c) => c.text)).toContain(
      'Could not update Notion: Notion is having a day',
    )
  })

  test('does nothing at all without a token', async () => {
    const task = tasks.create({ title: 'Fix it', notionPageId: 'page-1' })

    expect(() => pushOf(null).taskChanged(task.id)).not.toThrow()
    await settle()

    expect(tasks.comments(task.id)).toHaveLength(0)
  })

  test('a disposed push does not fire into a closing app', async () => {
    const { client, updates } = fakeClient([])
    const task = tasks.create({ title: 'Fix it', notionPageId: 'page-1' })
    const push = pushOf(client)

    push.taskChanged(task.id)
    push.dispose()
    await settle()

    expect(updates).toEqual([])
  })
})

describe('connections', () => {
  test('connecting the same data source twice replaces the mapping', () => {
    connections.create({ name: 'A', databaseId: 'db', dataSourceId: 'ds', mapping: MAPPING })
    connections.create({
      name: 'A renamed',
      databaseId: 'db',
      dataSourceId: 'ds',
      mapping: MAPPING,
    })

    expect(connections.findAll()).toHaveLength(1)
    expect(connections.findAll()[0]?.name).toBe('A renamed')
  })

  test('disconnecting leaves the tasks and their page ids alone', () => {
    const connection = connections.create({
      name: 'A',
      databaseId: 'db',
      dataSourceId: 'ds',
      mapping: MAPPING,
    })
    const task = tasks.create({ title: 'Imported', notionPageId: 'page-1' })

    connections.delete(connection.id)

    // Disconnecting is not a reason to delete someone's work, and keeping the
    // id means reconnecting recognises them rather than importing them twice.
    expect(tasks.findById(task.id)).not.toBeNull()
    expect(tasks.notionPageOf(task.id)).toBe('page-1')
  })

  test('a mapping that will not parse is empty rather than a crash on startup', () => {
    db.prepare(
      'INSERT INTO notion_connections' +
        ' (id, name, database_id, data_source_id, mapping, project_id, created_at)' +
        " VALUES ('c9', 'Broken', 'db', 'ds9', 'not json', NULL, 0)",
    ).run()

    expect(connections.findById('c9')?.mapping.status).toBeNull()
  })
})
