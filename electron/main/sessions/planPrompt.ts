import { join } from 'node:path'
import type { Plan, PlanComment } from '../../../shared/types'
import { worktreesDir } from '../store/paths'

/**
 * The prompts Roster sends on a plan's behalf, and the names the work lands
 * under.
 *
 * Pure on purpose: what an agent is told to do with your repository is worth
 * being able to read and test without starting a turn.
 */

/** Long enough to stay recognisable in a branch list, short enough to read. */
const MAX_SLUG = 40

/** Enough of a UUID to be unique in practice, short enough to type. */
const ID_LENGTH = 6

export interface PlanPromptInput {
  plan: Plan
  /** The current version, as Markdown. */
  body: string
  /** The whole thread; only your unanswered notes are used. */
  comments: readonly PlanComment[]
}

/**
 * The branch a plan is built on.
 *
 * Carries the plan's id so two plans with the same title cannot collide, and
 * its title so the branch means something in a list of them.
 */
export function branchFor(plan: Plan): string {
  const name = slugify(plan.title)
  const shortId = plan.id.slice(0, ID_LENGTH)

  return name === '' ? `roster/plan-${shortId}` : `roster/plan-${shortId}-${name}`
}

/**
 * Where the agent is told to put the worktree.
 *
 * Named after the branch and kept under Roster's own directory, so the work
 * never lands inside the checkout the agent is sitting in.
 */
export function worktreeFor(plan: Plan): string {
  return join(worktreesDir(), branchFor(plan).split('/').slice(1).join('-'))
}

/** Ask for another pass at the plan, not for the work. */
export function revisePrompt(input: PlanPromptInput): string {
  return [
    'Your plan has been reviewed. Revise it to take the notes below into account.',
    '',
    'Stay in plan mode: present the revised plan with ExitPlanMode when it is ready.',
    'Do not start the work yet.',
    '',
    notesSection(input),
    planSection(input),
  ].join('\n')
}

/**
 * The same request, as the reason an ExitPlanMode is refused.
 *
 * Short on purpose: the agent is still inside the turn that wrote the plan,
 * so reading the whole thing back to it would spend context on something it
 * is already holding.
 */
export function reviseReason(input: PlanPromptInput): string {
  const notes = yourNotes(input)

  return [
    'Not yet — revise the plan first:',
    '',
    ...notes.map(asLine),
    '',
    'Present the revised plan with ExitPlanMode when it is ready.',
  ].join('\n')
}

/**
 * How Roster answers the blocked call when a plan is approved.
 *
 * Approving would let the agent carry straight on in a turn that refuses
 * every edit, and in the checkout it is already sitting in. The build is its
 * own turn, so this one has to end first.
 */
export const APPROVED_REASON =
  'The plan is approved. Stop here — build instructions follow in the next turn.'

/** Ask for the work, in a worktree, ending in a pull request. */
export function buildPrompt(input: PlanPromptInput): string {
  const branch = branchFor(input.plan)
  const worktree = worktreeFor(input.plan)

  return [
    'The plan below is approved. Implement it.',
    '',
    'Work in an isolated worktree rather than the checkout you are in, so this',
    'work cannot disturb anything else in the repository:',
    '',
    `    git worktree add ${worktree} -b ${branch}`,
    '',
    `Do all of your work in ${worktree}.`,
    '',
    'When the work is done and the tests pass: commit it, push with -u, and open',
    'a pull request whose body is the plan below. Then report the pull request by',
    `calling mcp__plans__record_pull_request with plan_id "${input.plan.id}" and`,
    'its URL, so Roster can link to it.',
    '',
    notesSection(input),
    planSection(input),
  ].join('\n')
}

/**
 * Your notes on the version the agent is being asked about.
 *
 * Only your own, and only against the current version: the agent's own thread
 * lines are its log rather than instruction, and a note the last revision
 * already answered would ask for the same change twice.
 */
function notesSection(input: PlanPromptInput): string {
  const notes = yourNotes(input)
  if (notes.length === 0) return ''

  return ['--- REVIEW NOTES ---', ...notes.map(asLine), ''].join('\n')
}

/**
 * One note, with the passage it was written about.
 *
 * Naming the passage is most of what the note means: "make this nullable"
 * against a plan with four columns in it is a guess, and the agent should not
 * have to make it.
 */
function asLine(note: PlanComment): string {
  return note.quote === undefined ? `- ${note.text}` : `- On “${note.quote}”: ${note.text}`
}

function yourNotes(input: PlanPromptInput): readonly PlanComment[] {
  return input.comments.filter(
    (comment) => comment.tone === 'you' && comment.version === input.plan.version,
  )
}

function planSection(input: PlanPromptInput): string {
  return [`--- PLAN (v${input.plan.version}) ---`, input.body].join('\n')
}

/** A title as git will take it: lowercase, hyphenated, and bounded. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '')
}
