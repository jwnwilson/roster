import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { Db } from '../db'
import type { ProjectRepo } from '../../../shared/types'
import { isGitRepository } from '../sessions/repo'
import { canonicalPath } from '../sessions/workspace'
import { collapseHome } from './agentToml'

interface ProjectRepoRow {
  id: string
  project_id: string
  path: string
  name: string
  description: string
  position: number
  created_at: number
}

export interface NewProjectRepoInput {
  projectId: string
  path: string
  /** Defaults to basename(path) when omitted or blank. */
  name?: string
  description?: string
}

export type ProjectRepoPatch = Partial<Pick<ProjectRepo, 'name' | 'description'>>

/**
 * SQLite-backed store for the repositories a project names.
 *
 * Beside `ProjectStore` rather than inside it: the two answer different
 * questions and keeping them apart keeps both inside the house norm for file
 * size.
 *
 * Nothing here is reachable from an agent. There are deliberately no MCP
 * tools for adding a repository — a tool that let an agent point its own
 * project at a new directory would be the sharpest privilege escalation in
 * the app.
 */
export class ProjectRepoStore {
  constructor(private readonly db: Db) {}

  /** The project's repositories, primary first. */
  listByProject(projectId: string): ProjectRepo[] {
    const rows = this.db
      .prepare('SELECT * FROM project_repos WHERE project_id = ? ORDER BY position')
      .all(projectId) as ProjectRepoRow[]

    return rows.map(toProjectRepo)
  }

  /**
   * Adds a repository at the end of the project's list.
   *
   * The path is normalised before it is stored, because the table's
   * `UNIQUE (project_id, path)` index compares bytes: without this, `~/api`,
   * `/Users/n/api` and `/Users/n/api/` are three repositories on one project
   * and the index that exists to prevent exactly that never fires.
   *
   * Adding a path the project already has returns the existing row rather
   * than throwing. Choosing the same directory twice from a file picker is a
   * slip, not an error worth a dialog.
   */
  add(input: NewProjectRepoInput): ProjectRepo {
    const path = canonicalPath(input.path)

    const existing = this.db
      .prepare('SELECT * FROM project_repos WHERE project_id = ? AND path = ?')
      .get(input.projectId, path) as ProjectRepoRow | undefined
    if (existing) return toProjectRepo(existing)

    const name = input.name?.trim()
    const row: ProjectRepoRow = {
      id: randomUUID(),
      project_id: input.projectId,
      path,
      name: name === undefined || name === '' ? basename(path) : name,
      description: input.description?.trim() ?? '',
      position: this.nextPosition(input.projectId),
      created_at: Date.now(),
    }

    this.db
      .prepare(
        `INSERT INTO project_repos
           (id, project_id, path, name, description, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.project_id,
        row.path,
        row.name,
        row.description,
        row.position,
        row.created_at,
      )

    return toProjectRepo(row)
  }

  /**
   * Renames or re-describes a repository.
   *
   * The path is deliberately not patchable: changing where a repository
   * points is indistinguishable from removing it and adding another, and
   * doing it through this method would silently move every session that
   * resolved its workspace from the old path.
   */
  update(id: string, patch: ProjectRepoPatch): ProjectRepo {
    const current = this.findById(id)
    if (!current) throw new Error(`unknown project repository "${id}"`)

    const name = patch.name?.trim()
    const next: ProjectRepo = {
      ...current,
      // A blank name falls back to the directory's own, so clearing the field
      // cannot leave a nameless row in the brief.
      ...(patch.name !== undefined ? { name: name === '' ? basename(current.path) : name } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    }

    this.db
      .prepare('UPDATE project_repos SET name = ?, description = ? WHERE id = ?')
      .run(next.name, next.description, id)

    return next
  }

  /**
   * Removes a repository and closes the gap it leaves.
   *
   * Positions are compacted in the same transaction, because position 0 means
   * "primary" — a list that removed its first row and left the rest starting
   * at 1 would have no primary at all, and every turn on the project would
   * fall back to the agent's own directory without saying why.
   *
   * Answers with the project the row belonged to, or null when there was no
   * such row: the caller has to re-read and broadcast that project's list,
   * and once the row is gone there is nothing left to ask.
   */
  remove(id: string): string | null {
    const current = this.findById(id)
    if (!current) return null

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM project_repos WHERE id = ?').run(id)
      this.compact(current.projectId)
    })()

    return current.projectId
  }

  /**
   * Reorders one project's repositories to the given ids, primary first.
   *
   * Ids that do not belong to the project are ignored, and any the caller
   * left out keep their relative order at the end — a stale list from a
   * window that has not seen an addition yet must not silently delete it.
   *
   * Written in two passes because `position` is not unique: moving a row
   * through a position another row still holds is fine here, but doing it in
   * one pass makes the intermediate states depend on update order.
   */
  reorder(projectId: string, orderedIds: readonly string[]): ProjectRepo[] {
    const current = this.listByProject(projectId)
    const byId = new Map(current.map((repo) => [repo.id, repo]))

    const named = orderedIds.flatMap((id) => {
      const repo = byId.get(id)
      return repo ? [repo] : []
    })
    const namedIds = new Set(named.map((repo) => repo.id))
    const rest = current.filter((repo) => !namedIds.has(repo.id))

    const ordered = [...named, ...rest]

    this.db.transaction(() => {
      const statement = this.db.prepare('UPDATE project_repos SET position = ? WHERE id = ?')
      // Parked beyond every live position first, so no intermediate write can
      // collide with a row that has not moved yet.
      ordered.forEach((repo, index) => statement.run(index + ordered.length, repo.id))
      ordered.forEach((repo, index) => statement.run(index, repo.id))
    })()

    return this.listByProject(projectId)
  }

  private findById(id: string): ProjectRepo | null {
    const row = this.db.prepare('SELECT * FROM project_repos WHERE id = ?').get(id) as
      | ProjectRepoRow
      | undefined
    return row ? toProjectRepo(row) : null
  }

  private nextPosition(projectId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max FROM project_repos WHERE project_id = ?')
      .get(projectId) as { max: number }

    return row.max + 1
  }

  private compact(projectId: string): void {
    const rows = this.db
      .prepare('SELECT id FROM project_repos WHERE project_id = ? ORDER BY position')
      .all(projectId) as { id: string }[]

    const statement = this.db.prepare('UPDATE project_repos SET position = ? WHERE id = ?')
    rows.forEach((row, index) => statement.run(index, row.id))
  }
}

function toProjectRepo(row: ProjectRepoRow): ProjectRepo {
  return {
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    pathLabel: collapseHome(row.path),
    name: row.name,
    description: row.description,
    position: row.position,
    // Probed on read rather than stored: a checkout can be moved or deleted
    // between two reads, and a cached "it was there once" is the answer least
    // worth having.
    exists: existsSync(row.path),
    isRepository: isGitRepository(row.path),
  }
}
