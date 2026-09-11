import type { Project, Task, TaskComment, TaskPriority } from '../../../shared/types'
import { TASK_PRIORITIES } from '../../../shared/types'

/**
 * What a session filed under a project already knows.
 *
 * An agent starts every turn from its system prompt and nothing else, so
 * until now it had to be *told* to go and look at the board. This puts the
 * project in front of it instead: what the work is, what is open, what the
 * last agent concluded, and whatever the project's notes say.
 *
 * Built from the stores the session manager already holds — there is no
 * memory to keep in sync, because the board and NOTES.md are the memory.
 */

/**
 * How many characters of project the brief may spend before it starts
 * leaving things out.
 *
 * Every turn pays this, so it is a cost, not a ceiling to fill: ~2000
 * characters is a few hundred tokens, small against a context window and
 * large enough to carry a dozen tasks and the last few conclusions.
 */
export const PROJECT_BRIEF_BUDGET = 2000

/**
 * The most of that budget the notes may take.
 *
 * Without it a project whose NOTES.md has grown past the budget would push
 * the board out of its own brief entirely, and the newest thing an agent
 * did would be the first thing dropped. Compaction of long notes is the
 * spec's Phase 3; this is what keeps them survivable until then.
 */
const NOTES_BUDGET_SHARE = 0.5

/** One comment, cut to a line. Long enough for a conclusion, not a transcript. */
const COMMENT_EXCERPT_CHARS = 220

/**
 * Says what the block is before the model reads it.
 *
 * Without this the brief arrives glued to the front of the user's message
 * and reads as though the user typed it, which is how an agent ends up
 * answering the board instead of the person.
 */
const PREAMBLE =
  'Project context from Roster — the shared state of the project this session ' +
  'is filed under. Not written by the user.'

export interface ProjectBriefInput {
  project: Project
  /** Every task filed under this project. */
  tasks: readonly Task[]
  /** Every comment on those tasks, in the order they were written. */
  comments: readonly TaskComment[]
  /** Resolves an assignee id to a display name. */
  agentName: (agentId: string) => string | null
  /** The project's NOTES.md, when it has one. */
  notes?: string
}

/**
 * The project as a block of text, capped by PROJECT_BRIEF_BUDGET.
 *
 * Ordered by what a new agent most needs: the notes (standing decisions and
 * gotchas), then what is open, then what somebody last worked out. Each
 * section says how much it left out rather than trailing off — silent
 * truncation reads as "that is the whole project", which is the one thing
 * this must never claim.
 */
export function buildProjectBrief(input: ProjectBriefInput): string {
  const header = headerOf(input.project)

  let remaining = PROJECT_BRIEF_BUDGET - header.length
  const sections: string[] = []

  for (const block of blocksOf(input)) {
    // The notes are capped harder than the rest of the budget; see
    // NOTES_BUDGET_SHARE.
    const allowance =
      block.share === undefined
        ? remaining
        : Math.min(remaining, Math.floor(PROJECT_BRIEF_BUDGET * block.share))

    const rendered = fit(block, allowance)
    if (rendered === null) continue

    sections.push(rendered)
    remaining -= rendered.length
  }

  return header + sections.join('')
}

/* ---- the sections -------------------------------------------------------- */

interface Block {
  heading: string
  lines: readonly string[]
  /** How this block admits to what it dropped. */
  more: (dropped: number) => string
  /** A share of the whole budget this block may not exceed. */
  share?: number
  /**
   * Which end of the block is worth keeping when it does not all fit.
   *
   * Defaults to the head, because the board and the comments are already
   * ordered with what matters first. The notes are not — they are a file
   * that grows at the bottom.
   */
  keep?: 'head' | 'tail'
}

function blocksOf(input: ProjectBriefInput): Block[] {
  const open = input.tasks.filter((task) => task.status !== 'done')
  const done = input.tasks.filter((task) => task.status === 'done')

  return [
    {
      heading: 'Project notes',
      lines: noteLines(input.notes),
      more: (n) => `(+${n} earlier lines — use recall)`,
      share: NOTES_BUDGET_SHARE,
      // `remember` appends, so the recent end of the file is the bottom of
      // it. Keeping the head would mean the longer a project ran, the less
      // of what it had just learned reached the next agent — the feature
      // inverting exactly as it started to pay off.
      keep: 'tail',
    },
    {
      heading: 'Open tasks',
      lines: ranked(open).map((task) => taskLine(task, input.agentName)),
      more: (n) => `(+${n} more tasks — use list_tasks)`,
    },
    {
      heading: 'Done',
      lines: ranked(done).map((task) => taskLine(task, input.agentName)),
      more: (n) => `(+${n} more tasks — use list_tasks)`,
    },
    {
      heading: 'Recent comments',
      lines: commentLines(input.comments),
      more: (n) => `(+${n} more comments — use read_task)`,
    },
  ]
}

function headerOf(project: Project): string {
  const description = project.description.trim()
  const lines = [PREAMBLE, '', `Project: ${project.name}`]
  if (description !== '') lines.push(description)
  return lines.join('\n')
}

/**
 * Most urgent open work first.
 *
 * Priority rather than recency: a brief that has to stop halfway should have
 * spent what it had on the task somebody is most likely to be asked about.
 * Ties go to whatever moved most recently.
 */
function ranked(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.updatedAt - a.updatedAt,
  )
}

function priorityRank(priority: TaskPriority): number {
  return TASK_PRIORITIES.indexOf(priority)
}

function taskLine(task: Task, agentName: (agentId: string) => string | null): string {
  const who =
    task.assigneeId === null
      ? 'unassigned'
      : (agentName(task.assigneeId) ?? task.assigneeId)

  return `- ${task.id} [${task.status}] ${task.priority} — ${task.title} (${who})`
}

/**
 * What agents and the user actually said, newest first.
 *
 * History entries are dropped: "moved to In Review" is already implied by the
 * status on the line above, and a brief full of them would bury the one
 * comment that carries a conclusion. Newest first because a note from three
 * weeks ago is asserted with the same confidence as one from this morning,
 * and order is the only cue the model gets.
 */
function commentLines(comments: readonly TaskComment[]): string[] {
  return comments
    .map((comment, index) => ({ comment, index }))
    .filter((entry) => !entry.comment.isSystem)
    // Two comments written in the same millisecond tie on createdAt, so the
    // order they arrived in breaks it — the caller passes them oldest first,
    // which is the order the board stores them in.
    .sort((a, b) => b.comment.createdAt - a.comment.createdAt || b.index - a.index)
    .map(
      ({ comment }) => `- ${comment.author} on ${comment.taskId}: ${excerpt(comment.text)}`,
    )
}

/** One line, however the comment was written. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= COMMENT_EXCERPT_CHARS
    ? flat
    : `${flat.slice(0, COMMENT_EXCERPT_CHARS).trimEnd()}…`
}

/**
 * The notes file, line by line, in the order it is written.
 *
 * Deliberately not reordered: NOTES.md is a document the user writes in too,
 * and shuffling somebody's headings away from what sits under them would
 * make nonsense of the file they are reading in the editor. Recency wins by
 * the block keeping its tail instead — see Block.keep. What keeps a stale
 * note from reading as fact is that `remember` dates and attributes every
 * line it appends.
 */
function noteLines(notes: string | undefined): string[] {
  if (notes === undefined) return []
  return notes.split('\n').filter((line) => line.trim() !== '')
}

/* ---- fitting ------------------------------------------------------------- */

/**
 * A block, cut to what it is allowed to spend.
 *
 * Lines are taken from the end the block says is worth keeping until the
 * next one would not fit; then the trailer saying how many were dropped has
 * to fit too, which is why lines come back off again until it does. A block
 * whose heading alone does not fit, or which has nothing left once the
 * trailer is paid for, is left out entirely rather than shown as an empty
 * heading.
 */
function fit(block: Block, allowance: number): string | null {
  if (block.lines.length === 0) return null

  const opening = `\n\n${block.heading}\n`
  if (opening.length >= allowance) return null

  // Walked from the kept end, so whichever lines fall off are the ones the
  // block cares least about. Put back the right way round by `join`.
  const fromTail = block.keep === 'tail'
  const candidates = fromTail ? [...block.lines].reverse() : block.lines

  let taken = 0
  let used = opening.length

  for (const line of candidates) {
    const cost = line.length + 1
    if (used + cost > allowance) break
    used += cost
    taken += 1
  }

  // Room for the admission, taken back off the end if that is what it costs.
  while (taken > 0 && taken < candidates.length) {
    const trailer = block.more(candidates.length - taken)
    if (used + trailer.length + 1 <= allowance) {
      return join(opening, candidates.slice(0, taken), trailer, fromTail)
    }
    const dropped = candidates[taken - 1]
    used -= (dropped?.length ?? 0) + 1
    taken -= 1
  }

  if (taken === 0) return null
  return join(opening, candidates.slice(0, taken), null, fromTail)
}

/**
 * The kept lines, back in the block's own order, with the trailer on the
 * side the dropped ones were on — so `(+N earlier lines)` sits above the
 * notes it stands in for, and `(+N more tasks)` below the tasks.
 */
function join(
  opening: string,
  kept: readonly string[],
  trailer: string | null,
  fromTail: boolean,
): string {
  const lines = fromTail ? [...kept].reverse() : kept
  const admission = trailer === null ? [] : [trailer]
  const body = fromTail ? [...admission, ...lines] : [...lines, ...admission]
  // The opening already ends in a newline, so the lines are joined by one.
  return opening + body.join('\n')
}
