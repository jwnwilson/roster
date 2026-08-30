import type { TaskPriority, TaskStatus } from './types'

/**
 * The shapes that cross the IPC boundary for the Notion integration.
 *
 * The logic that builds and reads these lives in the main process — this is
 * only the vocabulary, so the connect modal can show a mapping and let
 * someone correct it.
 */

/** One property in a Notion data source's schema. */
export interface NotionProperty {
  name: string
  /** Notion's own type: `title`, `status`, `select`, `people`, `rich_text`… */
  type: string
  /** The choices, for `status` and `select`. Empty for everything else. */
  options: string[]
}

/**
 * Which Notion property plays each part, by property name.
 *
 * Null means "nothing here does that", which is a legitimate answer for a
 * database somebody built for another purpose.
 */
export interface NotionMapping {
  title: string | null
  status: string | null
  priority: string | null
  assignee: string | null
  /** Notion option name -> Roster status. */
  statusValues: Record<string, TaskStatus>
  /** Notion option name -> Roster priority. */
  priorityValues: Record<string, TaskPriority>
}

export const EMPTY_MAPPING: NotionMapping = {
  title: null,
  status: null,
  priority: null,
  assignee: null,
  statusValues: {},
  priorityValues: {},
}

/** A connected Notion data source. */
export interface NotionConnection {
  id: string
  name: string
  databaseId: string
  dataSourceId: string
  mapping: NotionMapping
  projectId: string | null
  createdAt: number
}

/** What an import did, so the modal can say so rather than just closing. */
export interface ImportSummary {
  created: number
  updated: number
  /** Pages with no title — a card with nothing on it helps nobody. */
  skipped: number
  failed: string[]
}

/**
 * What Roster found when it looked at a pasted database, before anything is
 * saved: the data source it will read, its properties, and a first guess at
 * the mapping for the user to correct.
 */
export interface NotionInspection {
  databaseId: string
  dataSourceId: string
  name: string
  properties: NotionProperty[]
  mapping: NotionMapping
  /** Board columns no Notion option maps onto — worth showing before importing. */
  unmapped: TaskStatus[]
}
