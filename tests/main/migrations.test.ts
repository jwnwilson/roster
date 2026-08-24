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
