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

  // A database ahead of this build is refused rather than opened.
  //
  // The loop below only runs forward, so without this it passes straight
  // through: every migration skipped, no error, and then the first query
  // touching a column this build expects fails somewhere deep inside a
  // feature — "no such column: task_id" from a comment box. Two builds
  // sharing one ~/roster is enough to cause it, which is how it was found.
  //
  // Refusing is also the safe half of the trade: a newer build may have
  // changed what existing columns mean, and writing to it on those terms
  // could corrupt data the newer build still has to read.
  if (applied > MIGRATIONS.length) {
    throw new Error(
      `This roster's database is at schema version ${applied}, but this build ` +
        `of Roster only understands ${MIGRATIONS.length}. It was last opened by ` +
        `a newer version of Roster. Update Roster, or point ROSTER_HOME at a ` +
        `different directory.`,
    )
  }

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
