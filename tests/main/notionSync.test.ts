import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { TaskStore } from '@main/store/tasks'
import { NotionSettingsStore, DEFAULT_STATUS_MAP } from '@main/store/notionSettings'
import { NotionPush } from '@main/notion/sync'
import type { NotionPages } from '@main/notion/pages'

const PAGE_ID = '1f8d872b594c80a4b2f400370af2b13f'
const YOU = { name: 'You', tone: 'you' as const }

function fakePages() {
  const statuses: string[] = []
  const comments: { pageId: string; text: string }[] = []
  const pages = {
    fetchPage: vi.fn(async () => ({ pageId: PAGE_ID, title: 'Ship it', status: 'Not started' })),
    setStatus: vi.fn(async (_pageId: string, status: string) => {
      statuses.push(status)
    }),
    addComment: vi.fn(async (pageId: string, text: string) => {
      comments.push({ pageId, text })
    }),
  }
  return { pages: pages as unknown as NotionPages, statuses, comments, spy: pages }
}

/** Lets the debounce (0ms here) and its promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

let db: Db
let tasks: TaskStore
let settings: NotionSettingsStore

beforeEach(() => {
  db = openDatabase(':memory:')
  tasks = new TaskStore(db, () => null)
  settings = new NotionSettingsStore(db)
})

function linkedTask(status: 'todo' | 'in_progress' = 'todo') {
  return tasks.create({ title: 'Ship it', status, notionPageId: PAGE_ID })
}

function pushTo(pages: NotionPages | null) {
  const push = new NotionPush(tasks, settings, () => pages, 0)
  tasks.subscribe((event) => {
    if (event.type === 'task-updated') push.taskChanged(event.task.id)
    if (event.type === 'comment') push.commentAdded(event.taskId, event.comment)
  })
  return push
}

describe('pushing a board change to the Notion page it came from', () => {
  test('writes the Notion name this status is mapped to', async () => {
    const { pages, statuses } = fakePages()
    pushTo(pages)
    const task = linkedTask()

    tasks.apply(task.id, { field: 'status', value: 'done' }, YOU)
    await settle()

    expect(statuses).toEqual([DEFAULT_STATUS_MAP.done])
  })

  test('uses the name the user chose for that column', async () => {
    const { pages, statuses } = fakePages()
    settings.saveStatusMap({ ...DEFAULT_STATUS_MAP, in_review: 'Needs review' })
    pushTo(pages)
    const task = linkedTask()

    tasks.apply(task.id, { field: 'status', value: 'in_review' }, YOU)
    await settle()

    expect(statuses).toEqual(['Needs review'])
  })

  test('sends one update for a card dragged through three columns', async () => {
    const { pages, statuses } = fakePages()
    pushTo(pages)
    const task = linkedTask()

    tasks.apply(task.id, { field: 'status', value: 'in_progress' }, YOU)
    tasks.apply(task.id, { field: 'status', value: 'in_review' }, YOU)
    tasks.apply(task.id, { field: 'status', value: 'done' }, YOU)
    await settle()

    expect(statuses).toEqual([DEFAULT_STATUS_MAP.done])
  })

  test('says nothing to Notion about a title or priority change', async () => {
    const { pages, spy } = fakePages()
    pushTo(pages)
    const task = linkedTask()

    tasks.apply(task.id, { field: 'priority', value: 'urgent' }, YOU)
    tasks.apply(task.id, { field: 'title', value: 'Ship it twice' }, YOU)
    await settle()

    expect(spy.setStatus).not.toHaveBeenCalled()
  })

  test('leaves a task that never came from Notion alone', async () => {
    const { pages, spy } = fakePages()
    pushTo(pages)
    const task = tasks.create({ title: 'Local work' })

    tasks.apply(task.id, { field: 'status', value: 'done' }, YOU)
    await settle()

    expect(spy.setStatus).not.toHaveBeenCalled()
  })

  test('does not repeat a status Notion already has', async () => {
    const { pages, statuses } = fakePages()
    pushTo(pages)
    const task = linkedTask()

    tasks.apply(task.id, { field: 'status', value: 'done' }, YOU)
    await settle()
    tasks.apply(task.id, { field: 'priority', value: 'low' }, YOU)
    tasks.apply(task.id, { field: 'status', value: 'done' }, YOU)
    await settle()

    expect(statuses).toEqual([DEFAULT_STATUS_MAP.done])
  })

  test('writes a comment on the task when Notion refuses the update', async () => {
    const { pages, spy } = fakePages()
    spy.setStatus.mockRejectedValueOnce(new Error('Notion is having a day'))
    pushTo(pages)
    const task = linkedTask()

    tasks.apply(task.id, { field: 'status', value: 'done' }, YOU)
    await settle()

    const thread = tasks.comments(task.id).map((comment) => comment.text)
    expect(thread).toContainEqual(expect.stringContaining('Could not update Notion: Notion is having a day'))
  })

  test('stays quiet while Notion is not connected', async () => {
    pushTo(null)
    const task = linkedTask()

    tasks.apply(task.id, { field: 'status', value: 'done' }, YOU)
    await settle()

    expect(tasks.comments(task.id).filter((comment) => !comment.isSystem)).toHaveLength(0)
  })

  test('stops its timers when the app is closing', async () => {
    const { pages, spy } = fakePages()
    const push = pushTo(pages)
    const task = linkedTask()

    tasks.apply(task.id, { field: 'status', value: 'done' }, YOU)
    push.dispose()
    await settle()

    expect(spy.setStatus).not.toHaveBeenCalled()
  })
})

describe('pushing a task comment to the Notion page', () => {
  test('sends what someone wrote, with their name', async () => {
    const { pages, comments } = fakePages()
    pushTo(pages)
    const task = linkedTask()

    tasks.comment(task.id, { author: 'You', tone: 'you', text: 'Blocked on review' })
    await settle()

    expect(comments).toEqual([{ pageId: PAGE_ID, text: 'You: Blocked on review' }])
  })

  test('keeps History out of Notion', async () => {
    const { pages, spy } = fakePages()
    pushTo(pages)
    const task = linkedTask()

    tasks.apply(task.id, { field: 'priority', value: 'urgent' }, YOU)
    await settle()

    expect(spy.addComment).not.toHaveBeenCalled()
  })

  test('does not send its own failure notes back to Notion', async () => {
    const { pages, spy } = fakePages()
    pushTo(pages)
    const task = linkedTask()

    tasks.comment(task.id, { author: 'Notion', tone: 'agent', text: 'Could not update Notion: nope' })
    await settle()

    expect(spy.addComment).not.toHaveBeenCalled()
  })

  test('leaves a task that never came from Notion alone', async () => {
    const { pages, spy } = fakePages()
    pushTo(pages)
    const task = tasks.create({ title: 'Local work' })

    tasks.comment(task.id, { author: 'You', tone: 'you', text: 'Hello' })
    await settle()

    expect(spy.addComment).not.toHaveBeenCalled()
  })

  test('notes on the task when the comment could not be sent', async () => {
    const { pages, spy } = fakePages()
    spy.addComment.mockRejectedValueOnce(new Error('no access'))
    pushTo(pages)
    const task = linkedTask()

    tasks.comment(task.id, { author: 'You', tone: 'you', text: 'Blocked' })
    await settle()

    expect(tasks.comments(task.id).map((comment) => comment.text)).toContainEqual(
      expect.stringContaining('Could not comment on Notion: no access'),
    )
  })
})
