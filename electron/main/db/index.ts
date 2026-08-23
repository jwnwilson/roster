import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATIONS } from './migrations'

export type Db = Database.Database

/**
 * Opens the database and brings it up to the latest schema. Safe to call on a
 * fresh file or an existing one; migrations run inside a transaction so a
 * failure leaves the previous version intact.
 */
export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  const [row] = db.pragma('user_version') as { user_version: number }[]
  const applied = row?.user_version ?? 0

  for (let version = applied; version < MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version]
    if (sql === undefined) continue

    db.transaction(() => {
      db.exec(sql)
      // pragma cannot be parameterised, and version is a loop index, not input.
      db.pragma(`user_version = ${version + 1}`)
    })()
  }
}
