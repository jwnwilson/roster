import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { migrate, openDatabase } from '@main/db'
import { MIGRATIONS } from '@main/db/migrations'

let db: ReturnType<typeof openDatabase>

beforeEach(() => {
  db = openDatabase(':memory:')
})

afterEach(() => {
  db.close()
})

function version(target: ReturnType<typeof openDatabase>): number {
  return (target.pragma('user_version') as { user_version: number }[])[0]?.user_version ?? 0
}

describe('migrations', () => {
  test('a fresh database lands on the latest version', () => {
    expect(version(db)).toBe(MIGRATIONS.length)
  })

  test('running again is a no-op', () => {
    migrate(db)

    expect(version(db)).toBe(MIGRATIONS.length)
  })

  test('usage carries a total_tokens column', () => {
    const columns = (db.pragma('table_info(usage)') as { name: string }[]).map((c) => c.name)

    expect(columns).toContain('total_tokens')
  })
})

describe('migration 2 — total tokens', () => {
  /** A database stopped at version 1, as an existing install would be. */
  function atVersion1() {
    const old = new Database(':memory:')
    old.pragma('foreign_keys = ON')
    old.exec(MIGRATIONS[0] as string)
    old.pragma('user_version = 1')
    return old
  }

  test('adds the column to a database that predates it', () => {
    const old = atVersion1()
    expect(
      (old.pragma('table_info(usage)') as { name: string }[]).map((c) => c.name),
    ).not.toContain('total_tokens')

    migrate(old)

    expect(
      (old.pragma('table_info(usage)') as { name: string }[]).map((c) => c.name),
    ).toContain('total_tokens')
    old.close()
  })

  test('backfills existing rows from input plus output', () => {
    const old = atVersion1()
    old.prepare(
      `INSERT INTO sessions (id, agent_id, title, origin, status, created_at)
       VALUES ('s1', 'debugging', 'x', 'you', 'done', 0)`,
    ).run()
    old.prepare(
      `INSERT INTO usage (session_id, input_tokens, output_tokens, cost_usd, context_used)
       VALUES ('s1', 100, 50, 0.25, 0.1)`,
    ).run()

    migrate(old)

    // The cache half of those old turns was never recorded, so this is the
    // best available figure — not the true total.
    const row = old.prepare('SELECT total_tokens FROM usage WHERE session_id = ?').get('s1')
    expect(row).toEqual({ total_tokens: 150 })
    old.close()
  })

  test('leaves a database with no usage rows alone', () => {
    const old = atVersion1()

    expect(() => migrate(old)).not.toThrow()
    expect(version(old)).toBe(MIGRATIONS.length)
    old.close()
  })
})

describe('migration 3 — the stored context fraction goes', () => {
  test('usage no longer carries context_used', () => {
    const columns = (db.pragma('table_info(usage)') as { name: string }[]).map((c) => c.name)

    // It was computed at turn time, so it went stale whenever an agent's
    // model changed, and it could not express "unknown model" at all.
    expect(columns).not.toContain('context_used')
  })

  test('drops it from a database that still has it', () => {
    const old = new Database(':memory:')
    old.pragma('foreign_keys = ON')
    old.exec(MIGRATIONS[0] as string)
    old.exec(MIGRATIONS[1] as string)
    old.pragma('user_version = 2')
    old.prepare(
      `INSERT INTO sessions (id, agent_id, title, origin, status, created_at)
       VALUES ('s1', 'debugging', 'x', 'you', 'done', 0)`,
    ).run()
    old.prepare(
      `INSERT INTO usage (session_id, input_tokens, output_tokens, total_tokens, cost_usd, context_used)
       VALUES ('s1', 100, 50, 150, 0.25, 0.58)`,
    ).run()

    migrate(old)

    const columns = (old.pragma('table_info(usage)') as { name: string }[]).map((c) => c.name)
    expect(columns).not.toContain('context_used')
    // The rest of the row survives the drop.
    expect(old.prepare('SELECT total_tokens, cost_usd FROM usage').get()).toEqual({
      total_tokens: 150,
      cost_usd: 0.25,
    })
    old.close()
  })
})

describe('migration 4 — the task board', () => {
  /** A database stopped at version 3, as an existing install would be. */
  function atVersion3(): ReturnType<typeof openDatabase> {
    const old = new Database(':memory:')
    old.pragma('foreign_keys = ON')
    for (let i = 0; i < 3; i += 1) old.exec(MIGRATIONS[i] as string)
    old.pragma('user_version = 3')
    return old
  }

  test('adds the three board tables and the key counter', () => {
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string
      }[]
    ).map((row) => row.name)

    expect(names).toContain('projects')
    expect(names).toContain('tasks')
    expect(names).toContain('task_comments')
    expect(names).toContain('counters')
  })

  test('gives sessions a project column', () => {
    const columns = (db.pragma('table_info(sessions)') as { name: string }[]).map((c) => c.name)

    expect(columns).toContain('project_id')
  })

  test('an existing install keeps its sessions, with no project yet', () => {
    const old = atVersion3()
    old.prepare(
      `INSERT INTO sessions (id, agent_id, title, origin, status, created_at)
       VALUES ('s1', 'debugging', 'Session leak on 504', 'you', 'done', 17)`,
    ).run()

    migrate(old)

    expect(old.prepare('SELECT id, title, project_id FROM sessions').get()).toEqual({
      id: 's1',
      title: 'Session leak on 504',
      project_id: null,
    })
    old.close()
  })

  test('a task refuses a status the board has no column for', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO tasks (id, title, status, priority, labels, created_at, updated_at)
           VALUES ('ROS-1', 'x', 'blocked', 'medium', '[]', 0, 0)`,
        )
        .run(),
    ).toThrow()
  })

  test('deleting a project leaves its tasks behind, without a project', () => {
    db.prepare(
      `INSERT INTO projects (id, name, color, created_at) VALUES ('p1', 'P', 'a', 0)`,
    ).run()
    db.prepare(
      `INSERT INTO tasks (id, title, status, priority, project_id, labels, created_at, updated_at)
       VALUES ('ROS-1', 'x', 'todo', 'medium', 'p1', '[]', 0, 0)`,
    ).run()

    db.prepare("DELETE FROM projects WHERE id = 'p1'").run()

    expect(db.prepare('SELECT project_id FROM tasks').get()).toEqual({ project_id: null })
  })

  test('deleting a task takes its thread with it', () => {
    db.prepare(
      `INSERT INTO tasks (id, title, status, priority, labels, created_at, updated_at)
       VALUES ('ROS-1', 'x', 'todo', 'medium', '[]', 0, 0)`,
    ).run()
    db.prepare(
      `INSERT INTO task_comments (id, task_id, author, tone, text, created_at)
       VALUES ('c1', 'ROS-1', 'you', 'you', 'hi', 0)`,
    ).run()

    db.prepare("DELETE FROM tasks WHERE id = 'ROS-1'").run()

    expect(db.prepare('SELECT COUNT(*) AS n FROM task_comments').get()).toEqual({ n: 0 })
  })
})
