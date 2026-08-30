import { BOARD_STATUSES, TASK_PRIORITIES } from '../../../shared/types'
import type { Task, TaskPriority, TaskStatus } from '../../../shared/types'
import { EMPTY_MAPPING, type NotionMapping, type NotionProperty } from '../../../shared/notion'

/**
 * Lining a Notion data source up with Roster's board.
 *
 * All pure, all offline — the guessing and the translating are where the
 * judgement is, so they are kept away from the HTTP and tested directly.
 *
 * Nothing here invents a property. A Notion database is whatever someone
 * made it, so every field is optional and a mapping that finds nothing is a
 * legitimate answer the UI can show and the user can correct.
 */

export { EMPTY_MAPPING }
export type { NotionMapping, NotionProperty }

/* ---- detection --------------------------------------------------------- */

/**
 * A first guess at which property is which.
 *
 * Type before name, because a type is a fact and a name is a habit: exactly
 * one property in any Notion database has type `title`, and a `status`-typed
 * property is unambiguously a status. Names are only consulted when the type
 * does not settle it.
 */
export function detectMapping(properties: readonly NotionProperty[]): NotionMapping {
  const byType = (type: string) => properties.find((property) => property.type === type) ?? null
  const named = (pattern: RegExp, types: readonly string[]) =>
    properties.find(
      (property) => types.includes(property.type) && pattern.test(property.name),
    ) ?? null

  const title = byType('title')
  const status = byType('status') ?? named(/status|state|stage/i, ['select'])
  const priority = named(/priority|urgency|importance/i, ['select', 'status'])
  const assignee = byType('people') ?? named(/assignee|owner|responsible/i, ['select'])

  return {
    title: title?.name ?? null,
    status: status?.name ?? null,
    priority: priority?.name ?? null,
    assignee: assignee?.name ?? null,
    statusValues: foldStatuses(status?.options ?? []),
    priorityValues: foldPriorities(priority?.options ?? []),
  }
}

/**
 * Notion's status option names folded onto Roster's five.
 *
 * Matched on letters alone, so "In progress", "In-Progress" and "IN PROGRESS"
 * all land in the same column. An option nothing recognises is left out
 * rather than guessed at — see toStatus for where those end up.
 */
function foldStatuses(options: readonly string[]): Record<string, TaskStatus> {
  const folded: Record<string, TaskStatus> = {}

  for (const option of options) {
    const key = letters(option)
    if (key === 'backlog' || key === 'ideas' || key === 'icebox') folded[option] = 'backlog'
    else if (key === 'todo' || key === 'notstarted' || key === 'new') folded[option] = 'todo'
    else if (key === 'inprogress' || key === 'doing' || key === 'started') {
      folded[option] = 'in_progress'
    } else if (key === 'inreview' || key === 'review' || key === 'reviewing') {
      folded[option] = 'in_review'
    } else if (key === 'done' || key === 'complete' || key === 'completed' || key === 'shipped') {
      folded[option] = 'done'
    }
  }

  return folded
}

function foldPriorities(options: readonly string[]): Record<string, TaskPriority> {
  const folded: Record<string, TaskPriority> = {}

  for (const option of options) {
    const key = letters(option)
    const match = TASK_PRIORITIES.find((priority) => priority === key)
    if (match) folded[option] = match
    else if (key === 'critical' || key === 'p0' || key === 'blocker') folded[option] = 'urgent'
    else if (key === 'p1') folded[option] = 'high'
    else if (key === 'normal' || key === 'p2') folded[option] = 'medium'
    else if (key === 'p3' || key === 'minor' || key === 'nice') folded[option] = 'low'
  }

  return folded
}

/** Lowercase letters and digits only, so punctuation and spacing stop mattering. */
function letters(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/* ---- Notion -> Roster --------------------------------------------------- */

/** What an import needs from one page. `null` fields simply are not mapped. */
export interface ImportedTask {
  pageId: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  /** A person's name as Notion gives it, resolved to an agent by the caller. */
  assigneeName: string | null
}

/**
 * One Notion page, read through a mapping.
 *
 * Returns null when the page has no title — a task with no title is a card
 * with nothing on it, and importing a blank row helps nobody.
 */
export function toTask(
  page: { id: string; properties: Record<string, unknown> },
  mapping: NotionMapping,
): ImportedTask | null {
  const title = readTitle(page.properties, mapping.title)
  if (title === null) return null

  return {
    pageId: page.id,
    title,
    status: toStatus(readOption(page.properties, mapping.status), mapping),
    priority: toPriority(readOption(page.properties, mapping.priority), mapping),
    assigneeName: readPerson(page.properties, mapping.assignee),
  }
}

/**
 * Anything unrecognised becomes backlog, deliberately.
 *
 * A column nobody mapped is not "To Do" — it is work whose state Roster does
 * not understand, and the backlog is exactly where unsorted work belongs.
 */
export function toStatus(option: string | null, mapping: NotionMapping): TaskStatus {
  if (option === null) return 'backlog'
  return mapping.statusValues[option] ?? 'backlog'
}

/** Medium is the same default TaskStore.create uses, so imports match hand-made tasks. */
export function toPriority(option: string | null, mapping: NotionMapping): TaskPriority {
  if (option === null) return 'medium'
  return mapping.priorityValues[option] ?? 'medium'
}

/* ---- Roster -> Notion --------------------------------------------------- */

/**
 * The `properties` body for a PATCH, carrying only what Roster owns.
 *
 * Title and description are never here: Notion stays authoritative for the
 * words, so an agent rewriting a description cannot overwrite what someone
 * wrote there.
 *
 * A field is omitted when it is not mapped, and a status is omitted when the
 * mapping has no option for it — sending a name the database does not define
 * is a 400, and silently clearing someone's column is worse than doing
 * nothing.
 */
export function toProperties(
  task: Pick<Task, 'status' | 'priority'>,
  mapping: NotionMapping,
  assigneeNotionId: string | null,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}

  if (mapping.status !== null) {
    const option = optionFor(mapping.statusValues, task.status)
    if (option !== null) properties[mapping.status] = { status: { name: option } }
  }

  if (mapping.priority !== null) {
    const option = optionFor(mapping.priorityValues, task.priority)
    if (option !== null) properties[mapping.priority] = { select: { name: option } }
  }

  // Only when we know who: an unresolved agent leaves the Notion assignee
  // alone rather than emptying it.
  if (mapping.assignee !== null && assigneeNotionId !== null) {
    properties[mapping.assignee] = { people: [{ id: assigneeNotionId }] }
  }

  return properties
}

/** The Notion option name that folds onto this Roster value, if any does. */
function optionFor<T extends string>(values: Record<string, T>, value: T): string | null {
  return Object.keys(values).find((option) => values[option] === value) ?? null
}

/* ---- reading Notion's property payloads --------------------------------- */

function readTitle(properties: Record<string, unknown>, name: string | null): string | null {
  if (name === null) return null

  const property = properties[name]
  if (!isRecord(property) || !Array.isArray(property['title'])) return null

  const text = property['title']
    .map((part) => (isRecord(part) && typeof part['plain_text'] === 'string' ? part['plain_text'] : ''))
    .join('')
    .trim()

  return text === '' ? null : text
}

/** `status` and `select` payloads differ only in their key. */
function readOption(properties: Record<string, unknown>, name: string | null): string | null {
  if (name === null) return null

  const property = properties[name]
  if (!isRecord(property)) return null

  for (const key of ['status', 'select']) {
    const value = property[key]
    if (isRecord(value) && typeof value['name'] === 'string') return value['name']
  }

  return null
}

/** The first person on the property. Roster has one assignee; Notion allows several. */
function readPerson(properties: Record<string, unknown>, name: string | null): string | null {
  if (name === null) return null

  const property = properties[name]
  if (!isRecord(property)) return null

  const people = property['people']
  if (Array.isArray(people)) {
    const first = people[0]
    if (isRecord(first) && typeof first['name'] === 'string') return first['name']
    return null
  }

  // A select standing in for an assignee, which is how plenty of boards do it.
  return readOption(properties, name)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every status has to be reachable, or work would import into a column and never leave. */
export function unmappedStatuses(mapping: NotionMapping): TaskStatus[] {
  const reachable = new Set(Object.values(mapping.statusValues))
  return BOARD_STATUSES.filter((status) => !reachable.has(status))
}
