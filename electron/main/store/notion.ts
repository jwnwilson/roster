import { randomUUID } from 'node:crypto'
import type { Db } from '../db'
import { EMPTY_MAPPING, type NotionConnection, type NotionMapping } from '../../../shared/notion'

/**
 * The Notion databases this board is connected to.
 *
 * Only the wiring lives here — which data source, and how its properties line
 * up with ours. The token does not: it stays in mcp.json under the `notion`
 * server, so there is one copy of it and one place to type it.
 */

interface ConnectionRow {
  id: string
  name: string
  database_id: string
  data_source_id: string
  mapping: string
  project_id: string | null
  created_at: number
}

export interface NewConnectionInput {
  name: string
  databaseId: string
  dataSourceId: string
  mapping: NotionMapping
  projectId?: string | null
}

export type { NotionConnection }

export class NotionStore {
  constructor(private readonly db: Db) {}

  findAll(): NotionConnection[] {
    const rows = this.db
      .prepare('SELECT * FROM notion_connections ORDER BY created_at')
      .all() as ConnectionRow[]
    return rows.map(toConnection)
  }

  findById(id: string): NotionConnection | null {
    const row = this.db.prepare('SELECT * FROM notion_connections WHERE id = ?').get(id) as
      | ConnectionRow
      | undefined
    return row ? toConnection(row) : null
  }

  /** Connecting the same data source twice replaces the mapping rather than doubling it. */
  create(input: NewConnectionInput): NotionConnection {
    const existing = this.db
      .prepare('SELECT id FROM notion_connections WHERE data_source_id = ?')
      .get(input.dataSourceId) as { id: string } | undefined

    if (existing) {
      this.db
        .prepare(
          'UPDATE notion_connections SET name = ?, mapping = ?, project_id = ? WHERE id = ?',
        )
        .run(input.name, JSON.stringify(input.mapping), input.projectId ?? null, existing.id)

      const updated = this.findById(existing.id)
      if (!updated) throw new Error(`lost connection "${existing.id}" while updating it`)
      return updated
    }

    const connection: NotionConnection = {
      id: randomUUID(),
      name: input.name,
      databaseId: input.databaseId,
      dataSourceId: input.dataSourceId,
      mapping: input.mapping,
      projectId: input.projectId ?? null,
      createdAt: Date.now(),
    }

    this.db
      .prepare(
        `INSERT INTO notion_connections
           (id, name, database_id, data_source_id, mapping, project_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        connection.id,
        connection.name,
        connection.databaseId,
        connection.dataSourceId,
        JSON.stringify(connection.mapping),
        connection.projectId,
        connection.createdAt,
      )

    return connection
  }

  /**
   * Forgets the connection. The tasks it imported stay, and keep their page
   * ids — disconnecting is not a reason to delete someone's work, and if the
   * same database is connected again those tasks are recognised rather than
   * imported a second time.
   */
  delete(id: string): void {
    this.db.prepare('DELETE FROM notion_connections WHERE id = ?').run(id)
  }
}

function toConnection(row: ConnectionRow): NotionConnection {
  return {
    id: row.id,
    name: row.name,
    databaseId: row.database_id,
    dataSourceId: row.data_source_id,
    mapping: parseMapping(row.mapping),
    projectId: row.project_id,
    createdAt: row.created_at,
  }
}

/** A mapping that will not parse is an empty one, not a crash on startup. */
function parseMapping(raw: string): NotionMapping {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? { ...EMPTY_MAPPING, ...(parsed as Partial<NotionMapping>) }
      : EMPTY_MAPPING
  } catch {
    return EMPTY_MAPPING
  }
}
