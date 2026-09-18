import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { TaskStore } from '@main/store/tasks'
import { NotionSettingsStore } from '@main/store/notionSettings'
import { importNotionTask } from '@main/notion/importTask'
import type { NotionPageInfo, NotionPages } from '@main/notion/pages'

const PAGE_ID = '1f8d872b594c80a4b2f400370af2b13f'
const PAGE_URL = `https://www.notion.so/Ship-the-thing-${PAGE_ID}`

function fakePages(info: Partial<NotionPageInfo> = {}): NotionPages & { fetchPage: ReturnType<typeof vi.fn> } {
  return {
    fetchPage: vi.fn(async () => ({ pageId: PAGE_ID, title: 'Ship the thing', status: 'In progress', ...info })),
    setStatus: vi.fn(async () => undefined),
    addComment: vi.fn(async () => undefined),
  } as unknown as NotionPages & { fetchPage: ReturnType<typeof vi.fn> }
}

let db: Db
let tasks: TaskStore
let settings: NotionSettingsStore

beforeEach(() => {
  db = openDatabase(':memory:')
  tasks = new TaskStore(db, () => null)
  settings = new NotionSettingsStore(db)
})

describe('importing a Notion page as a task', () => {
  test('creates the task with the mapped status and a link back to the page', async () => {
    const pages = fakePages()

    const result = await importNotionTask(pages, tasks, settings, { url: PAGE_URL, projectId: null })

    expect(result.created).toBe(true)
    expect(result.task).toMatchObject({ title: 'Ship the thing', status: 'in_progress' })
    expect(result.task.description).toContain(`https://www.notion.so/${PAGE_ID}`)
    expect(pages.fetchPage).toHaveBeenCalledWith(PAGE_ID)
    expect(tasks.notionPageOf(result.task.id)).toBe(PAGE_ID)
  })

  test('keeps the task on the board it was asked for', async () => {
    db.prepare("INSERT INTO projects (id, name, color, description, created_at) VALUES ('proj-1', 'Roster', 'a', '', 0)").run()

    const result = await importNotionTask(fakePages(), tasks, settings, { url: PAGE_URL, projectId: 'proj-1' })

    expect(result.task.projectId).toBe('proj-1')
  })

  test('uses To Do for a page whose status no map entry names', async () => {
    const result = await importNotionTask(fakePages({ status: 'Icebox' }), tasks, settings, {
      url: PAGE_URL,
      projectId: null,
    })

    expect(result.task.status).toBe('todo')
  })

  test('returns the task already on the board instead of a second copy', async () => {
    const first = await importNotionTask(fakePages(), tasks, settings, { url: PAGE_URL, projectId: null })

    const again = await importNotionTask(fakePages(), tasks, settings, { url: `${PAGE_URL}?pvs=4`, projectId: null })

    expect(again).toEqual({ task: expect.objectContaining({ id: first.task.id }), created: false })
    expect(tasks.findAll()).toHaveLength(1)
  })

  test('reads the page id out of a link to a page inside a database view', async () => {
    const pages = fakePages()

    await importNotionTask(pages, tasks, settings, {
      url: `https://www.notion.so/team/0123456789abcdef0123456789abcdef?v=abc&p=${PAGE_ID}`,
      projectId: null,
    })

    expect(pages.fetchPage).toHaveBeenCalledWith(PAGE_ID)
  })

  test('says so when the link is not a Notion page', async () => {
    await expect(
      importNotionTask(fakePages(), tasks, settings, { url: 'https://example.com/tasks/4', projectId: null }),
    ).rejects.toThrow('does not look like a Notion page link')
  })

  test('falls back to the link when the page has no title', async () => {
    const result = await importNotionTask(fakePages({ title: '' }), tasks, settings, {
      url: PAGE_URL,
      projectId: null,
    })

    expect(result.task.title).toBe('Untitled Notion page')
  })
})
