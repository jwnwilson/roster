import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { DEFAULT_STATUS_MAP, NotionSettingsStore } from '@main/store/notionSettings'

let db: Db

beforeEach(() => {
  db = openDatabase(':memory:')
})

afterEach(() => db.close())

describe('the Roster-to-Notion status map', () => {
  test('starts on the names a default Notion board uses', () => {
    const store = new NotionSettingsStore(db)

    expect(store.statusMap()).toEqual(DEFAULT_STATUS_MAP)
    expect(store.statusMap().done).toBe('Done')
  })

  test('remembers an edited map', () => {
    const store = new NotionSettingsStore(db)

    store.saveStatusMap({ ...DEFAULT_STATUS_MAP, in_review: 'Needs review', done: 'Shipped' })

    expect(new NotionSettingsStore(db).statusMap()).toMatchObject({
      in_review: 'Needs review',
      done: 'Shipped',
      todo: DEFAULT_STATUS_MAP.todo,
    })
  })

  test('fills in any status the stored map is missing', () => {
    db.prepare('INSERT INTO notion_settings (id, status_map) VALUES (1, ?)').run('{"done":"Shipped"}')

    expect(new NotionSettingsStore(db).statusMap()).toEqual({ ...DEFAULT_STATUS_MAP, done: 'Shipped' })
  })

  test('falls back to the defaults when the stored map is unreadable', () => {
    db.prepare('INSERT INTO notion_settings (id, status_map) VALUES (1, ?)').run('not json')

    expect(new NotionSettingsStore(db).statusMap()).toEqual(DEFAULT_STATUS_MAP)
  })

  test('puts a page on the board when its name is shared with Backlog', () => {
    // The defaults call Backlog and To Do the same thing, and a page that
    // arrives in a backlog nobody looks at is a page nobody sees.
    expect(new NotionSettingsStore(db).statusFor(DEFAULT_STATUS_MAP.todo)).toBe('todo')
  })

  test('still reads a name given to Backlog alone', () => {
    const store = new NotionSettingsStore(db)
    store.saveStatusMap({ ...DEFAULT_STATUS_MAP, backlog: 'Icebox' })

    expect(store.statusFor('Icebox')).toBe('backlog')
  })

  test('reads a Notion status name back to a Roster status, whatever its case', () => {
    const store = new NotionSettingsStore(db)
    store.saveStatusMap({ ...DEFAULT_STATUS_MAP, done: 'Shipped' })

    expect(store.statusFor('shipped')).toBe('done')
    expect(store.statusFor('In progress')).toBe('in_progress')
    expect(store.statusFor('Something else')).toBe('todo')
    expect(store.statusFor(null)).toBe('todo')
  })
})
