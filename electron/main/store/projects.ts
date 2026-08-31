import { randomUUID } from 'node:crypto'
import type { Db } from '../db'
import type { Project } from '../../../shared/types'

interface ProjectRow {
  id: string
  name: string
  color: string
  description: string
  created_at: number
  archived_at: number | null
}

export interface NewProjectInput {
  name: string
  color: string
  description?: string
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'color' | 'description'>>

/**
 * SQLite-backed store for projects.
 *
 * A project is metadata and nothing else — it labels tasks and sessions but
 * owns neither, which is why deleting one detaches rather than cascades.
 */
export class ProjectStore {
  constructor(private readonly db: Db) {}

  /**
   * Every project, archived ones included.
   *
   * Deliberately unfiltered: Spend and every task card resolve a project name
   * by id, and old work filed under an archived project would read as unfiled
   * if the row stopped being listed. Which projects are still offered is a
   * question for the renderer, not for the store.
   */
  findAll(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects ORDER BY created_at')
      .all() as ProjectRow[]
    return rows.map(toProject)
  }

  findById(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | ProjectRow
      | undefined
    return row ? toProject(row) : null
  }

  create(input: NewProjectInput): Project {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      color: input.color,
      description: input.description ?? '',
      createdAt: Date.now(),
      archivedAt: null,
    }

    this.db
      .prepare(
        `INSERT INTO projects (id, name, color, description, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(project.id, project.name, project.color, project.description, project.createdAt)

    return project
  }

  update(id: string, patch: ProjectPatch): Project {
    const current = this.findById(id)
    if (!current) throw new Error(`unknown project "${id}"`)

    const next: Project = { ...current, ...patch }
    this.db
      .prepare('UPDATE projects SET name = ?, color = ?, description = ? WHERE id = ?')
      .run(next.name, next.color, next.description, id)

    return next
  }

  /**
   * Puts a project away, or brings it back.
   *
   * The row and everything pointing at it are untouched — only whether the
   * app still offers it changes. That is the whole difference from delete:
   * archiving is a decision you can take back.
   *
   * Separate from `update` on purpose, so saving the edit form can never
   * archive or restore a project as a side effect of renaming it.
   */
  setArchived(id: string, archived: boolean): Project {
    const current = this.findById(id)
    if (!current) throw new Error(`unknown project "${id}"`)

    const archivedAt = archived ? Date.now() : null
    this.db.prepare('UPDATE projects SET archived_at = ? WHERE id = ?').run(archivedAt, id)

    return { ...current, archivedAt }
  }

  /**
   * Removes the project and detaches everything pointing at it.
   *
   * Tasks lose their project through the foreign key; sessions are detached
   * by hand, because SQLite cannot add a foreign key to an existing table and
   * `sessions.project_id` arrived in a later migration than the table did.
   * Either way nothing is deleted but the project — losing a grouping must
   * never lose the work that was grouped.
   */
  delete(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE sessions SET project_id = NULL WHERE project_id = ?').run(id)
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    })()
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  }
}
