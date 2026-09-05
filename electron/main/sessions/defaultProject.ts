import type { Agent, Project } from '../../../shared/types'

/** Just enough of ProjectStore to check a default is still worth using. */
export interface ProjectLookup {
  findById(id: string): Project | null
}

export interface SessionProjectInput {
  /**
   * The project the caller chose. Present — null included — it decides;
   * absent, the agent's default does.
   */
  explicit?: string | null
  agent: Agent | null
  /** Omitted when nothing can resolve a project id, in which case no default applies. */
  projects?: ProjectLookup
}

/**
 * Which project a new session is filed under.
 *
 * An agent may name a default project, so sessions opened on it land in the
 * right place without anyone filing them by hand. Two rules keep that from
 * getting in the way:
 *
 * - A project the caller chose always wins, including an explicit "none".
 * - A default that no longer resolves — deleted, or archived and therefore
 *   hidden from the board — is ignored rather than honoured. Filing a live
 *   session under an archived project would hide it, and refusing to open one
 *   over a stale id would break the agent outright. The agent.toml keeps the
 *   dangling id: restoring the project restores the default with it.
 */
export function resolveSessionProject(input: SessionProjectInput): string | null {
  if (input.explicit !== undefined) return input.explicit

  const defaultProjectId = input.agent?.defaultProjectId ?? null
  if (defaultProjectId === null) return null

  const project = input.projects?.findById(defaultProjectId) ?? null
  if (project === null || project.archivedAt !== null) return null

  return project.id
}
