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

describe('migration 5 — backlog becomes a status', () => {
  /** A database stopped at version 4, as an existing install would be. */
  function atVersion4() {
    const old = new Database(':memory:')
    old.pragma('foreign_keys = ON')
    for (let i = 0; i < 4; i += 1) old.exec(MIGRATIONS[i] as string)
    old.pragma('user_version = 4')
    return old
  }

  /** A task, its project, and a thread holding both kinds of comment. */
  function seed(target: ReturnType<typeof atVersion4>) {
    target
      .prepare(
        "INSERT INTO projects (id, name, color, description, created_at)" +
          " VALUES ('p1', 'API reliability', '#7c5cff', 'x', 0)",
      )
      .run()
    target
      .prepare(
        'INSERT INTO tasks (id, title, description, status, priority, assignee_id,' +
          ' project_id, labels, created_at, updated_at)' +
          " VALUES ('ROS-1', 'Fix pool leak', 'body', 'in_review', 'high', 'debugging'," +
          " 'p1', '[\"bug\"]', 11, 22)",
      )
      .run()
    target
      .prepare(
        'INSERT INTO task_comments (id, task_id, author, tone, text, is_system, created_at)' +
          " VALUES ('c1', 'ROS-1', 'You', 'you', 'a note', 0, 0)",
      )
      .run()
    target
      .prepare(
        'INSERT INTO task_comments (id, task_id, author, tone, text, is_system, created_at)' +
          " VALUES ('c2', 'ROS-1', 'You', 'you', 'You moved this to In Review.', 1, 1)",
      )
      .run()
  }

  const fileTo = (target: ReturnType<typeof atVersion4>, id: string) =>
    target
      .prepare(
        'INSERT INTO tasks (id, title, status, priority, labels, created_at, updated_at)' +
          ` VALUES ('${id}', 'idea', 'backlog', 'low', '[]', 0, 0)`,
      )
      .run()

  test('a task can be filed to the backlog, which version 4 refused', () => {
    const old = atVersion4()
    expect(() => fileTo(old, 'ROS-1')).toThrow()

    migrate(old)

    expect(() => fileTo(old, 'ROS-2')).not.toThrow()
    old.close()
  })

  test('keeps every comment and History line', () => {
    // The regression this exists for: widening the CHECK means rebuilding
    // tasks, and dropping it fires task_comments' ON DELETE CASCADE — which
    // would silently take every thread in the database with it.
    const old = atVersion4()
    seed(old)

    migrate(old)

    expect(
      old.prepare('SELECT id, text, is_system FROM task_comments ORDER BY created_at').all(),
    ).toEqual([
      { id: 'c1', text: 'a note', is_system: 0 },
      { id: 'c2', text: 'You moved this to In Review.', is_system: 1 },
    ])
    old.close()
  })

  test('carries every column of the task across untouched', () => {
    const old = atVersion4()
    seed(old)

    migrate(old)

    expect(old.prepare('SELECT * FROM tasks').get()).toEqual({
      id: 'ROS-1',
      title: 'Fix pool leak',
      description: 'body',
      status: 'in_review',
      priority: 'high',
      assignee_id: 'debugging',
      project_id: 'p1',
      labels: '["bug"]',
      created_at: 11,
      updated_at: 22,
      // Migration 6 adds this; a task that predates it came from nowhere.
      notion_page_id: null,
    })
    old.close()
  })

  test('leaves the rebuilt tables sound, with their indexes and foreign keys', () => {
    const old = atVersion4()
    seed(old)

    migrate(old)

    expect(old.pragma('foreign_key_check')).toEqual([])
    expect(old.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])

    const indexes = (old.pragma('index_list(tasks)') as { name: string }[]).map((i) => i.name)
    expect(indexes).toContain('ix_tasks_status')
    expect(indexes).toContain('ix_tasks_project')

    // The child has to point at the new tasks table, not the one renamed
    // aside during the rebuild.
    expect(old.pragma('foreign_key_list(task_comments)')).toMatchObject([{ table: 'tasks' }])
    old.close()
  })

  test('a thread still follows its task to the grave afterwards', () => {
    const old = atVersion4()
    seed(old)
    migrate(old)

    old.prepare("DELETE FROM tasks WHERE id = 'ROS-1'").run()

    // Rebuilding must not have quietly dropped the cascade on the way.
    expect(old.prepare('SELECT COUNT(*) AS n FROM task_comments').get()).toEqual({ n: 0 })
    old.close()
  })

  test('leaves a database with no tasks alone', () => {
    const old = atVersion4()

    expect(() => migrate(old)).not.toThrow()
    expect(version(old)).toBe(MIGRATIONS.length)
    old.close()
  })
})

describe('migration 6 — tasks remember the Notion page they came from', () => {
  /** A database stopped at version 5, as an install from before this would be. */
  function atVersion5() {
    const old = new Database(':memory:')
    old.pragma('foreign_keys = ON')
    for (let i = 0; i < 5; i += 1) old.exec(MIGRATIONS[i] as string)
    old.pragma('user_version = 5')
    return old
  }

  const insert = (target: ReturnType<typeof atVersion5>, id: string, page?: string) =>
    target
      .prepare(
        'INSERT INTO tasks (id, title, status, priority, labels, created_at, updated_at' +
          (page === undefined ? '' : ', notion_page_id') +
          `) VALUES ('${id}', 'x', 'todo', 'medium', '[]', 0, 0` +
          (page === undefined ? '' : `, '${page}'`) +
          ')',
      )
      .run()

  test('adds the column to a database that predates it', () => {
    const old = atVersion5()
    const before = (old.pragma('table_info(tasks)') as { name: string }[]).map((c) => c.name)
    expect(before).not.toContain('notion_page_id')

    migrate(old)

    expect((old.pragma('table_info(tasks)') as { name: string }[]).map((c) => c.name)).toContain(
      'notion_page_id',
    )
    old.close()
  })

  test('a task that predates the column simply came from nowhere', () => {
    const old = atVersion5()
    insert(old, 'ROS-1')

    migrate(old)

    expect(old.prepare('SELECT notion_page_id FROM tasks').get()).toEqual({
      notion_page_id: null,
    })
    old.close()
  })

  test('one Notion page cannot become two tasks', () => {
    const old = atVersion5()
    migrate(old)
    insert(old, 'ROS-1', 'page-abc')

    // Without this, a second import would deal every page another task and
    // another key.
    expect(() => insert(old, 'ROS-2', 'page-abc')).toThrow()
    old.close()
  })

  test('but any number of tasks can have come from nowhere', () => {
    const old = atVersion5()
    migrate(old)

    // A partial index: the uniqueness applies to page ids, not to nulls, or
    // the second hand-made task would be rejected.
    insert(old, 'ROS-1')
    expect(() => insert(old, 'ROS-2')).not.toThrow()
    old.close()
  })

  test('a connection survives the project it was filed under being deleted', () => {
    const old = atVersion5()
    migrate(old)
    old.prepare(
      "INSERT INTO projects (id, name, color, description, created_at)" +
        " VALUES ('p1', 'API', '#fff', '', 0)",
    ).run()
    old.prepare(
      'INSERT INTO notion_connections' +
        ' (id, name, database_id, data_source_id, mapping, project_id, created_at)' +
        " VALUES ('c1', 'Tasks', 'db', 'ds', '{}', 'p1', 0)",
    ).run()

    old.prepare("DELETE FROM projects WHERE id = 'p1'").run()

    // Detached, not deleted — the same call projects already make for tasks.
    expect(old.prepare('SELECT project_id FROM notion_connections').get()).toEqual({
      project_id: null,
    })
    old.close()
  })
})

describe('migration 7 — a project can be archived instead of destroyed', () => {
  /** A database stopped at version 6, as an install from before this would be. */
  function atVersion6() {
    const old = new Database(':memory:')
    old.pragma('foreign_keys = ON')
    for (let i = 0; i < 6; i += 1) old.exec(MIGRATIONS[i] as string)
    old.pragma('user_version = 6')
    return old
  }

  const insertProject = (target: ReturnType<typeof atVersion6>, id: string) =>
    target
      .prepare(
        'INSERT INTO projects (id, name, color, description, created_at)' +
          ` VALUES ('${id}', 'API reliability', '#7c5cff', 'x', 7)`,
      )
      .run()

  test('adds the column to a database that predates it', () => {
    const old = atVersion6()
    expect(
      (old.pragma('table_info(projects)') as { name: string }[]).map((c) => c.name),
    ).not.toContain('archived_at')

    migrate(old)

    expect(
      (old.pragma('table_info(projects)') as { name: string }[]).map((c) => c.name),
    ).toContain('archived_at')
    old.close()
  })

  test('every project that predates the column is active', () => {
    const old = atVersion6()
    insertProject(old, 'p1')

    migrate(old)

    // NULL means active. An existing install must not wake up with its
    // projects put away.
    expect(old.prepare('SELECT name, archived_at FROM projects').get()).toEqual({
      name: 'API reliability',
      archived_at: null,
    })
    old.close()
  })

  test('archiving a project keeps the tasks filed under it', () => {
    const old = atVersion6()
    migrate(old)
    insertProject(old, 'p1')
    old.prepare(
      'INSERT INTO tasks (id, title, status, priority, project_id, labels, created_at, updated_at)' +
        " VALUES ('ROS-1', 'x', 'todo', 'medium', 'p1', '[]', 0, 0)",
    ).run()

    old.prepare("UPDATE projects SET archived_at = 99 WHERE id = 'p1'").run()

    // An archive that lost the work it grouped would be a delete with extra
    // steps: the row stays, and everything keeps pointing at it.
    expect(old.prepare('SELECT project_id FROM tasks').get()).toEqual({ project_id: 'p1' })
    expect(old.prepare('SELECT archived_at FROM projects').get()).toEqual({ archived_at: 99 })
    old.close()
  })
})

describe('migration 8 — plans', () => {
  /** A database stopped at version 7, as an existing install would be. */
  function atVersion7() {
    const old = new Database(':memory:')
    old.pragma('foreign_keys = ON')
    for (const step of MIGRATIONS.slice(0, 7)) old.exec(step)
    old.pragma('user_version = 7')
    return old
  }

  function insertSession(target: Database.Database, id: string): void {
    target
      .prepare(
        'INSERT INTO sessions (id, agent_id, title, origin, status, created_at)' +
          " VALUES (?, 'debugging', 'Work', 'you', 'idle', 0)",
      )
      .run(id)
  }

  function insertPlan(target: Database.Database, id: string, sessionId: string): void {
    target
      .prepare(
        'INSERT INTO plans (id, session_id, agent_id, title, status, version, created_at, updated_at)' +
          " VALUES (?, ?, 'debugging', 'Do it', 'draft', 1, 0, 0)",
      )
      .run(id, sessionId)
  }

  test('adds the tables to a database that predates them', () => {
    const old = atVersion7()
    const before = (old.pragma('table_list') as { name: string }[]).map((t) => t.name)
    expect(before).not.toContain('plans')

    migrate(old)

    const after = (old.pragma('table_list') as { name: string }[]).map((t) => t.name)
    expect(after).toContain('plans')
    expect(after).toContain('plan_comments')
    old.close()
  })

  test('a plan keeps only metadata — the body is a file, not a column', () => {
    const old = atVersion7()
    migrate(old)

    const columns = (old.pragma('table_info(plans)') as { name: string }[]).map((c) => c.name)
    expect(columns).toEqual([
      'id',
      'session_id',
      'agent_id',
      'title',
      'status',
      'version',
      'branch',
      'pr_url',
      'created_at',
      'updated_at',
    ])
    old.close()
  })

  test('refuses a status outside the four the feature has', () => {
    const old = atVersion7()
    migrate(old)
    insertSession(old, 's1')

    expect(() =>
      old
        .prepare(
          'INSERT INTO plans (id, session_id, agent_id, title, status, version, created_at, updated_at)' +
            " VALUES ('p1', 's1', 'debugging', 'Do it', 'archived', 1, 0, 0)",
        )
        .run(),
    ).toThrow(/CHECK/)
    old.close()
  })

  test('losing the session takes its plans and their thread with it', () => {
    const old = atVersion7()
    migrate(old)
    insertSession(old, 's1')
    insertPlan(old, 'p1', 's1')
    old
      .prepare(
        'INSERT INTO plan_comments (id, plan_id, author, tone, text, version, created_at)' +
          " VALUES ('c1', 'p1', 'You', 'you', 'change section 3', 1, 0)",
      )
      .run()

    // A plan with no session is a document about a conversation that no
    // longer exists; the thread goes with it.
    old.prepare("DELETE FROM sessions WHERE id = 's1'").run()

    expect(old.prepare('SELECT COUNT(*) AS n FROM plans').get()).toEqual({ n: 0 })
    expect(old.prepare('SELECT COUNT(*) AS n FROM plan_comments').get()).toEqual({ n: 0 })
    old.close()
  })
})

describe('migration 9 — quoting a plan in a comment', () => {
  /** A database stopped at version 8, as an install on the last build would be. */
  function atVersion8() {
    const old = new Database(':memory:')
    old.pragma('foreign_keys = ON')
    for (const step of MIGRATIONS.slice(0, 8)) old.exec(step)
    old.pragma('user_version = 8')
    return old
  }

  function seedComment(target: Database.Database): void {
    target
      .prepare(
        'INSERT INTO sessions (id, agent_id, title, origin, status, created_at)' +
          " VALUES ('s1', 'debugging', 'Work', 'you', 'idle', 0)",
      )
      .run()
    target
      .prepare(
        'INSERT INTO plans (id, session_id, agent_id, title, status, version, created_at, updated_at)' +
          " VALUES ('p1', 's1', 'debugging', 'Do it', 'draft', 1, 0, 0)",
      )
      .run()
    target
      .prepare(
        'INSERT INTO plan_comments (id, plan_id, author, tone, text, version, created_at)' +
          " VALUES ('c1', 'p1', 'You', 'you', 'change section 3', 1, 0)",
      )
      .run()
  }

  test('adds the column to a database that predates it', () => {
    const old = atVersion8()
    expect(
      (old.pragma('table_info(plan_comments)') as { name: string }[]).map((c) => c.name),
    ).not.toContain('quote')

    migrate(old)

    expect(
      (old.pragma('table_info(plan_comments)') as { name: string }[]).map((c) => c.name),
    ).toContain('quote')
    old.close()
  })

  test('a note written before this reads as a note about the whole plan', () => {
    const old = atVersion8()
    seedComment(old)

    migrate(old)

    // NULL means "no passage": the note stands, it simply points at nothing
    // in particular, which is what it always did.
    expect(old.prepare('SELECT text, quote FROM plan_comments').get()).toEqual({
      text: 'change section 3',
      quote: null,
    })
    old.close()
  })
})
