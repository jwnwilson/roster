import type { TaskComment } from '../../../shared/types'
import type { NotionSettingsStore } from '../store/notionSettings'
import type { TaskStore } from '../store/tasks'
import type { NotionPages } from './pages'

/**
 * Keeping a Notion page in step with the task it was imported as.
 *
 * One direction only. Roster writes status moves and comments to Notion and
 * never reads them back, so nothing rewrites the board while nobody is
 * looking — a page edited in Notion simply follows the board the next time
 * the card moves.
 *
 * Debounced per task, because dragging a card through three columns should be
 * one write rather than three. Silent for tasks that did not come from Notion,
 * which is most of them.
 */

/** The author Roster writes its own notes under; never sent to Notion. */
const NOTION = 'Notion'

export class NotionPush {
  private pending = new Map<string, NodeJS.Timeout>()
  /** The status each page was last told about, so a re-save writes nothing. */
  private pushed = new Map<string, string>()

  constructor(
    private readonly tasks: TaskStore,
    private readonly settings: NotionSettingsStore,
    private readonly pagesFor: () => NotionPages | null,
    private readonly delayMs = 800,
  ) {}

  taskChanged(taskId: string): void {
    if (this.tasks.notionPageOf(taskId) === null) return

    const existing = this.pending.get(taskId)
    if (existing) clearTimeout(existing)

    this.pending.set(
      taskId,
      setTimeout(() => {
        this.pending.delete(taskId)
        void this.pushStatus(taskId)
      }, this.delayMs),
    )
  }

  /**
   * Sends what someone wrote on the task.
   *
   * Not debounced: two comments are two comments, unlike two drags of the
   * same card. History is left out — Notion has its own record of what
   * changed — and so is anything Roster wrote as "Notion", which would
   * otherwise send a failure note straight back at the page that caused it.
   */
  commentAdded(taskId: string, comment: TaskComment): void {
    if (comment.isSystem || comment.author === NOTION) return
    const pageId = this.tasks.notionPageOf(taskId)
    if (pageId === null) return

    const pages = this.pagesFor()
    if (pages === null) return

    void pages
      .addComment(pageId, `${comment.author}: ${comment.text}`)
      .catch((cause: unknown) => this.report(taskId, 'Could not comment on Notion', cause))
  }

  /** Stops the timers, so a closing app does not fire one into a dead process. */
  dispose(): void {
    for (const [, timer] of this.pending) clearTimeout(timer)
    this.pending.clear()
  }

  private async pushStatus(taskId: string): Promise<void> {
    const pageId = this.tasks.notionPageOf(taskId)
    if (pageId === null) return

    const task = this.tasks.findById(taskId)
    if (!task) return

    const pages = this.pagesFor()
    if (pages === null) return

    const notionStatus = this.settings.statusMap()[task.status]
    if (this.pushed.get(pageId) === notionStatus) return

    try {
      // Any change to the task lands here, most of them nothing to do with
      // status. Asking the page what it says first keeps Roster from writing
      // a status Notion already has — including the very first change after
      // a restart, when nothing is remembered yet.
      const current = await pages.fetchPage(pageId)
      if (current.status !== notionStatus) await pages.setStatus(pageId, notionStatus)
      this.pushed.set(pageId, notionStatus)
    } catch (cause) {
      this.report(taskId, 'Could not update Notion', cause)
    }
  }

  /**
   * Written where someone looking at the task will find it. There is no
   * notification system to raise this in, and a silent failure would leave
   * Notion quietly wrong.
   */
  private report(taskId: string, what: string, cause: unknown): void {
    // .message, not String(cause): the latter renders an Error as
    // "Error: Notion is having a day", which is not a sentence.
    const detail = cause instanceof Error ? cause.message : String(cause)
    this.tasks.comment(taskId, { author: NOTION, tone: 'agent', text: `${what}: ${detail}` })
  }
}
