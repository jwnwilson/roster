import type { Task } from '../../../shared/types'
import type { NotionSettingsStore } from '../store/notionSettings'
import type { TaskStore } from '../store/tasks'
import { notionPageIdFrom, notionPageUrl } from './ids'
import type { NotionPages } from './pages'

export interface ImportTaskInput {
  url: string
  projectId: string | null
}

export interface ImportedTaskResult {
  task: Task
  /** False when the page was already on the board, so the UI can say so. */
  created: boolean
}

const UNTITLED = 'Untitled Notion page'

/**
 * Puts one Notion page on the board.
 *
 * Importing the same page twice is a normal thing to do — someone pastes a
 * link they already pasted — so the second attempt hands back the task that
 * exists rather than making a duplicate to reconcile later.
 *
 * The link lives in the task description, because a markdown link is already
 * rendered and opened externally everywhere a description is shown.
 */
export async function importNotionTask(
  pages: NotionPages,
  tasks: TaskStore,
  settings: NotionSettingsStore,
  input: ImportTaskInput,
): Promise<ImportedTaskResult> {
  const pageId = notionPageIdFrom(input.url)
  if (pageId === null) throw new Error('That does not look like a Notion page link.')

  const existing = tasks.findByNotionPage(pageId)
  if (existing) return { task: existing, created: false }

  const page = await pages.fetchPage(pageId)
  const title = page.title.trim()

  const task = tasks.create({
    title: title === '' ? UNTITLED : title,
    description: `[Open in Notion](${notionPageUrl(pageId)})`,
    status: settings.statusFor(page.status),
    projectId: input.projectId,
    notionPageId: pageId,
  })

  return { task, created: true }
}
