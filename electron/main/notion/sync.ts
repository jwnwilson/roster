import type { Agent } from '../../../shared/types'
import type { TaskStore } from '../store/tasks'
import type { NotionStore } from '../store/notion'
import type { ImportSummary, NotionConnection } from '../../../shared/notion'
import { NotionClient } from './client'
import { toProperties, toTask } from './mapping'

/**
 * Moving work between Notion and the board.
 *
 * Import is a pull you ask for. Push is automatic: when a task changes,
 * whatever Notion page it came from changes with it. Notion is never polled —
 * nothing rewrites the board while nobody is looking.
 */

/** Enough of the agent list to resolve a Notion person to an agent and back. */
export type AgentLookup = () => readonly Agent[]

/**
 * Pulls a data source onto the board.
 *
 * Deletions in Notion are ignored on purpose: a page that vanished might have
 * been moved, archived or filtered, and none of those is a reason to delete
 * work someone may be part-way through.
 */
export async function importConnection(
  client: NotionClient,
  connection: NotionConnection,
  tasks: TaskStore,
  agents: AgentLookup,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportSummary> {
  const pages = await client.pages(connection.dataSourceId)
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, failed: [] }

  for (const [index, page] of pages.entries()) {
    const imported = toTask(page, connection.mapping)
    if (imported === null) {
      summary.skipped += 1
      onProgress?.(index + 1, pages.length)
      continue
    }

    const assigneeId = agentIdFor(imported.assigneeName, agents())

    try {
      const existing = tasks.findByNotionPage(imported.pageId)

      if (existing) {
        // Only what Notion owns. Anything else on the task — labels, the
        // description someone wrote here, comments — is left alone.
        applyIfChanged(tasks, existing.id, 'status', existing.status, imported.status)
        applyIfChanged(tasks, existing.id, 'priority', existing.priority, imported.priority)
        applyIfChanged(tasks, existing.id, 'title', existing.title, imported.title)
        if (assigneeId !== null && assigneeId !== existing.assigneeId) {
          tasks.apply(existing.id, { field: 'assignee', value: assigneeId }, IMPORTER)
        }
        summary.updated += 1
      } else {
        tasks.create({
          title: imported.title,
          status: imported.status,
          priority: imported.priority,
          assigneeId,
          projectId: connection.projectId,
          notionPageId: imported.pageId,
        })
        summary.created += 1
      }
    } catch (cause) {
      // One bad row must not abandon the rest of the import.
      summary.failed.push(`${imported.title}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }

    onProgress?.(index + 1, pages.length)
  }

  return summary
}

/** Imports are attributed to Notion, so History says where a change came from. */
const IMPORTER = { name: 'Notion', tone: 'agent' as const }

function applyIfChanged(
  tasks: TaskStore,
  taskId: string,
  field: 'status' | 'priority' | 'title',
  current: string,
  next: string,
): void {
  if (current === next) return
  // The union is narrowed by the caller; each field carries its own value type.
  tasks.apply(taskId, { field, value: next } as never, IMPORTER)
}

/**
 * A Notion person matched to an agent by name, or nobody.
 *
 * The one place an agent's name carries meaning rather than just labelling
 * something — everywhere else in Roster points at the id. So renaming an
 * agent does change who Notion's people resolve to, which is the behaviour
 * to want: the name is how a person in Notion and an agent here are the same
 * one, and changing it is saying they are not.
 *
 * Both sides are trimmed because neither is typed here: a Notion display
 * name arrives as the workspace has it, and only Roster's own names are
 * normalized on the way in. Names being unique case-insensitively is what
 * makes the match a match rather than whichever agent `find` reached first.
 */
function agentIdFor(name: string | null, agents: readonly Agent[]): string | null {
  if (name === null) return null

  const wanted = name.trim().toLowerCase()
  if (wanted === '') return null

  const match = agents.find((agent) => agent.name.trim().toLowerCase() === wanted)
  return match?.id ?? null
}

/* ---- pushing back ------------------------------------------------------- */

/**
 * Writes board changes onto the Notion pages they came from.
 *
 * Debounced per task, because dragging a card through three columns should be
 * one write rather than three. Silent for tasks that did not come from Notion,
 * which is most of them.
 */
export class NotionPush {
  private pending = new Map<string, NodeJS.Timeout>()
  /** True while an import is running, so pulled rows do not immediately push back. */
  private importing = false

  constructor(
    private readonly tasks: TaskStore,
    private readonly connections: NotionStore,
    private readonly agents: AgentLookup,
    private readonly clientFor: () => NotionClient | null,
    private readonly delayMs = 800,
  ) {}

  /** Suppresses pushes for the duration — an import would otherwise echo. */
  async duringImport<T>(work: () => Promise<T>): Promise<T> {
    this.importing = true
    try {
      return await work()
    } finally {
      this.importing = false
    }
  }

  taskChanged(taskId: string): void {
    if (this.importing) return

    const existing = this.pending.get(taskId)
    if (existing) clearTimeout(existing)

    this.pending.set(
      taskId,
      setTimeout(() => {
        this.pending.delete(taskId)
        void this.push(taskId)
      }, this.delayMs),
    )
  }

  /** Stops the timers, so a closing app does not fire one into a dead process. */
  dispose(): void {
    for (const [, timer] of this.pending) clearTimeout(timer)
    this.pending.clear()
  }

  private async push(taskId: string): Promise<void> {
    const pageId = this.tasks.notionPageOf(taskId)
    if (pageId === null) return

    const task = this.tasks.findById(taskId)
    if (!task) return

    const client = this.clientFor()
    if (client === null) return

    // One connection per data source, and a task belongs to whichever one
    // imported it; with several, the mapping is the same shape either way.
    const connection = this.connections.findAll()[0]
    if (!connection) return

    const properties = toProperties(task, connection.mapping, null)
    if (Object.keys(properties).length === 0) return

    try {
      await client.updatePage(pageId, properties)
    } catch (cause) {
      // Written where someone looking at the task will find it. There is no
      // notification system to raise this in, and a silent failure would
      // leave Notion quietly wrong.
      // .message, not String(cause): the latter renders an Error as
      // "Error: Notion is having a day", which is not a sentence.
      const detail = cause instanceof Error ? cause.message : String(cause)
      this.tasks.comment(taskId, {
        author: 'Notion',
        tone: 'agent',
        text: `Could not update Notion: ${detail}`,
      })
    }
  }
}
