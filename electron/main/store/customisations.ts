import type { Db } from '../db'
import type { Customisation, CustomisationStatus } from '../../../shared/types'
import { collapseHome } from './agentToml'

interface CustomisationRow {
  id: string
  name: string
  path: string
  fork_remote: string | null
  base_sha: string | null
  roster_home: string
  dev_port: number
  status: CustomisationStatus
  last_error: string | null
  acknowledged_at: number
  created_at: number
}

export interface NewCustomisation {
  id: string
  name: string
  path: string
  forkRemote: string | null
  baseSha: string | null
  rosterHome: string
  devPort: number
  acknowledgedAt: number
  createdAt: number
}

/** SQLite-backed record of each customised copy. Starts every row provisioning. */
export class CustomisationStore {
  constructor(private readonly db: Db) {}

  list(): Customisation[] {
    const rows = this.db
      .prepare('SELECT * FROM customisations ORDER BY created_at, id')
      .all() as CustomisationRow[]
    return rows.map(toCustomisation)
  }

  findById(id: string): Customisation | null {
    const row = this.db.prepare('SELECT * FROM customisations WHERE id = ?').get(id) as
      | CustomisationRow
      | undefined
    return row ? toCustomisation(row) : null
  }

  insert(copy: NewCustomisation): void {
    this.db
      .prepare(
        `INSERT INTO customisations
           (id, name, path, fork_remote, base_sha, roster_home, dev_port, status,
            last_error, acknowledged_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'provisioning', NULL, ?, ?)`,
      )
      .run(
        copy.id,
        copy.name,
        copy.path,
        copy.forkRemote,
        copy.baseSha,
        copy.rosterHome,
        copy.devPort,
        copy.acknowledgedAt,
        copy.createdAt,
      )
  }

  /**
   * Sets the status and, when given, the base commit. The error is replaced
   * on every call, so a retry that succeeds clears the last failure.
   */
  setStatus(
    id: string,
    status: CustomisationStatus,
    options: { baseSha?: string | null; error?: string | null } = {},
  ): void {
    const current = this.findById(id)
    if (!current) throw new Error(`unknown customised copy "${id}"`)
    this.db
      .prepare('UPDATE customisations SET status = ?, base_sha = ?, last_error = ? WHERE id = ?')
      .run(
        status,
        options.baseSha !== undefined ? options.baseSha : current.baseSha,
        options.error ?? null,
        id,
      )
  }

  /** Ports held by any copy, whether or not it is running. */
  usedPorts(): number[] {
    const rows = this.db.prepare('SELECT dev_port FROM customisations').all() as { dev_port: number }[]
    return rows.map((row) => row.dev_port)
  }

  /**
   * A provision that was running when Roster quit can never finish. Mark it
   * failed so the user sees it and can retry, rather than a spinner forever.
   */
  recoverInterrupted(): number {
    const result = this.db
      .prepare(
        `UPDATE customisations SET status = 'failed', last_error = ?
         WHERE status = 'provisioning'`,
      )
      .run('Setup was interrupted before it finished. Retry to continue.')
    return result.changes
  }
}

function toCustomisation(row: CustomisationRow): Customisation {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    pathLabel: collapseHome(row.path),
    forkRemote: row.fork_remote,
    baseSha: row.base_sha,
    rosterHome: row.roster_home,
    devPort: row.dev_port,
    status: row.status,
    error: row.last_error,
    progress: null,
    acknowledgedAt: row.acknowledged_at,
    createdAt: row.created_at,
  }
}
