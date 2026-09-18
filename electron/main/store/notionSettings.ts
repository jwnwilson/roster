import { BOARD_STATUSES, TASK_STATUSES, type TaskStatus } from '../../../shared/types'
import type { NotionStatusMap } from '../../../shared/notion'
import type { Db } from '../db'

/**
 * What each Roster status is called in Notion.
 *
 * Roster has five statuses and a Notion board usually has three, so the map
 * is deliberately many-to-one: two Roster statuses may name the same Notion
 * option. Reading back the other way therefore has to break ties, which
 * READ_ORDER does.
 */
export const DEFAULT_STATUS_MAP: NotionStatusMap = {
  backlog: 'Not started',
  todo: 'Not started',
  in_progress: 'In progress',
  in_review: 'In progress',
  done: 'Done',
}

/**
 * Which Roster status wins when several are called the same thing in Notion.
 *
 * Board columns first, so a page whose status maps to both Backlog and To Do
 * arrives on the board rather than in a backlog nobody is looking at. Backlog
 * is only reached by a name given to it alone.
 */
const READ_ORDER: readonly TaskStatus[] = [...BOARD_STATUSES, 'backlog']

interface Row {
  status_map: string
}

/**
 * A stored map, or nothing.
 *
 * Unreadable JSON means the defaults rather than an error: the map is a
 * convenience, and refusing to open the board over it would be worse than
 * naming a column wrongly until someone corrects it.
 */
function parse(raw: string): Partial<NotionStatusMap> {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return {}
    const stored = value as Record<string, unknown>
    const map: Partial<NotionStatusMap> = {}
    for (const status of TASK_STATUSES) {
      const name = stored[status]
      if (typeof name === 'string' && name.trim() !== '') map[status] = name
    }
    return map
  } catch {
    return {}
  }
}

export class NotionSettingsStore {
  constructor(private readonly db: Db) {}

  statusMap(): NotionStatusMap {
    const row = this.db.prepare('SELECT status_map FROM notion_settings WHERE id = 1').get() as Row | undefined
    if (!row) return DEFAULT_STATUS_MAP
    return { ...DEFAULT_STATUS_MAP, ...parse(row.status_map) }
  }

  saveStatusMap(map: NotionStatusMap): void {
    this.db
      .prepare(
        `INSERT INTO notion_settings (id, status_map) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET status_map = excluded.status_map`,
      )
      .run(JSON.stringify({ ...DEFAULT_STATUS_MAP, ...map }))
  }

  /**
   * The Roster status a Notion option name means, for import.
   *
   * Compared without case or surrounding space, because "In Progress" and
   * "in progress" are the same column to everyone but a string comparison.
   * An option the map does not mention becomes To Do rather than nothing:
   * the page is on the board either way, and To Do is the honest guess.
   */
  statusFor(notionStatus: string | null): TaskStatus {
    if (!notionStatus) return 'todo'
    const wanted = notionStatus.trim().toLowerCase()
    const map = this.statusMap()
    return READ_ORDER.find((status) => map[status].trim().toLowerCase() === wanted) ?? 'todo'
  }
}
