import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db'
import type { Plan, PlanComment, PlanStatus } from '../../../shared/types'
import { IN_FLIGHT, isInFlight } from '../../../shared/plans'
import { summarisePlan } from '../runners/normalizeClaude'
import { planDir } from './paths'

interface PlanRow {
  id: string
  session_id: string
  agent_id: string
  title: string
  status: PlanStatus
  version: number
  branch: string | null
  pr_url: string | null
  created_at: number
  updated_at: number
}

interface PlanCommentRow {
  id: string
  plan_id: string
  author: string
  tone: 'you' | 'agent'
  text: string
  quote: string | null
  version: number
  created_at: number
}

export type PlanEvent =
  | { type: 'plan-updated'; plan: Plan }
  | { type: 'comment'; planId: string; comment: PlanComment }

/** A note someone is adding to a plan, with the passage it is about. */
export interface NewPlanComment {
  author: string
  tone: 'you' | 'agent'
  text: string
  quote?: string
}

export interface CaptureInput {
  sessionId: string
  agentId: string
  /** The whole plan, as the agent wrote it. */
  body: string
  /**
   * Why the plan already in flight is obsolete, when the agent says it is.
   *
   * Only consulted once a plan has moved past your review: until then a new
   * body is simply the next version, and there is nothing to abandon.
   */
  supersedeReason?: string
}

/** Said in the agent's own name, so the thread reads as a conversation. */
function revisedLine(version: number): string {
  return `Revised the plan — v${version}.`
}

/**
 * Plans an agent has proposed.
 *
 * Split between SQLite and the filesystem on purpose: the row is what has to
 * be queryable — which session, how far it got, which pull request — and the
 * body is a file at `~/roster/plans/<id>/v<N>.md`, because a plan is
 * something you read and keep rather than something the app merely stores.
 *
 * Like `TaskStore` and unlike the other SQLite stores, this one publishes its
 * changes: an agent revising a plan and a person commenting on it are two
 * writers, and an open modal has to hear about both.
 */
export class PlanStore {
  private listeners = new Set<(event: PlanEvent) => void>()

  constructor(private readonly db: Db) {}

  subscribe(listener: (event: PlanEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: PlanEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  /* ---- reads ------------------------------------------------------------ */

  findById(id: string): Plan | null {
    const row = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | undefined
    return row ? toPlan(row) : null
  }

  listBySession(sessionId: string): Plan[] {
    const rows = this.db
      .prepare('SELECT * FROM plans WHERE session_id = ? ORDER BY created_at, rowid')
      .all(sessionId) as PlanRow[]
    return rows.map(toPlan)
  }

  /** The Markdown of the current version. */
  body(planId: string): string {
    const plan = this.require(planId)
    return readFileSync(versionPath(plan.id, plan.version), 'utf8')
  }

  comments(planId: string): PlanComment[] {
    const rows = this.db
      .prepare('SELECT * FROM plan_comments WHERE plan_id = ? ORDER BY created_at, rowid')
      .all(planId) as PlanCommentRow[]
    return rows.map(toComment)
  }

  /* ---- writes ----------------------------------------------------------- */

  /**
   * Records what an agent just proposed.
   *
   * A plan reaches Roster twice — once through the approval callback and once
   * through the tool stream, in no guaranteed order — so an identical body is
   * the same plan, returned unchanged.
   *
   * Otherwise it depends on how far the session's open plan had got:
   *
   * - still in your hands — a draft, or out being revised — and the new body
   *   is its next version, back with you as a draft. Nothing is in flight, so
   *   there is nothing to abandon.
   * - building or up for review, and the agent said why it is obsolete: that
   *   plan is closed with the reason, keeping its history, branch and pull
   *   request, and the new body starts a plan of its own at v1. Two
   *   approaches are two documents.
   * - building or up for review with no reason given: refused. Versioning in
   *   place would reset work already under way to a draft and offer you
   *   "Approve & build" on a branch that is already building.
   */
  capture(input: CaptureInput): Plan {
    const current = this.newestOpenFor(input.sessionId)

    if (current && this.body(current.id) === input.body) return current

    if (current && isInFlight(current.status)) {
      return this.supersede(current, input)
    }

    const plan = current
      ? this.writeVersion(current, input.body, input.supersedeReason)
      : this.writeFirst(input, input.body)

    this.emit({ type: 'plan-updated', plan })
    return plan
  }

  /**
   * Closes a plan the agent has given up on.
   *
   * Terminal, and deliberately says why in the thread: a plan that simply
   * stopped being offered for approval reads as a bug, and the reason is the
   * only record of what replaced it.
   */
  close(planId: string, input: { author: string; reason: string }): Plan {
    const plan = this.require(planId)
    const closed: Plan = { ...plan, status: 'closed', updatedAt: Date.now() }

    this.save(closed)
    this.writeComment(closed, { author: input.author, tone: 'agent', text: input.reason })
    this.emit({ type: 'plan-updated', plan: closed })
    return closed
  }

  comment(planId: string, input: NewPlanComment): PlanComment {
    const comment = this.writeComment(this.require(planId), input)
    this.emit({ type: 'comment', planId, comment })
    return comment
  }

  /** Moves a plan on, recording the branch when a build is starting. */
  setStatus(planId: string, status: PlanStatus, input: { branch?: string } = {}): Plan {
    const plan = this.require(planId)
    const updated: Plan = {
      ...plan,
      status,
      ...(input.branch !== undefined ? { branch: input.branch } : {}),
      updatedAt: Date.now(),
    }

    this.save(updated)
    this.emit({ type: 'plan-updated', plan: updated })
    return updated
  }

  /**
   * The agent reporting the pull request it opened.
   *
   * The branch is optional because it was already recorded when the plan was
   * approved; an agent that branched differently can say so.
   */
  recordPullRequest(planId: string, input: { url: string; branch?: string }): Plan {
    const plan = this.require(planId)
    const updated: Plan = {
      ...plan,
      status: 'in_review',
      prUrl: input.url,
      ...(input.branch !== undefined ? { branch: input.branch } : {}),
      updatedAt: Date.now(),
    }

    this.save(updated)
    this.emit({ type: 'plan-updated', plan: updated })
    return updated
  }

  /* ---- helpers ---------------------------------------------------------- */

  private require(planId: string): Plan {
    const plan = this.findById(planId)
    if (!plan) throw new Error(`unknown plan "${planId}"`)
    return plan
  }

  /**
   * The plan a session is currently working on — its most recent open one.
   *
   * Closed plans are skipped, and that is the whole point of the word "open":
   * a closed plan is finished history, and versioning one would bring it back
   * as a draft you would be asked to approve all over again.
   */
  private newestOpenFor(sessionId: string): Plan | null {
    const open = this.listBySession(sessionId).filter((plan) => plan.status !== 'closed')
    return open.at(-1) ?? null
  }

  /**
   * Closes the plan in flight and opens the replacement beside it.
   *
   * `capture` has already established there is a reason to do this; without
   * one the caller is refused, because silently resetting a build to a draft
   * is worse than an error an agent can read.
   */
  private supersede(current: Plan, input: CaptureInput): Plan {
    const reason = input.supersedeReason?.trim()
    if (reason === undefined || reason === '') {
      throw new Error(
        `plan "${current.id}" is already ${IN_FLIGHT[current.status]}` +
          ' — say why it is obsolete to supersede it',
      )
    }

    this.close(current.id, { author: agentAuthor(current), reason })

    const plan = this.writeFirst(input, input.body)
    this.emit({ type: 'plan-updated', plan })
    return plan
  }

  private writeFirst(input: CaptureInput, body: string): Plan {
    const now = Date.now()
    const plan: Plan = {
      id: randomUUID(),
      sessionId: input.sessionId,
      agentId: input.agentId,
      title: planTitle(body),
      status: 'draft',
      version: 1,
      createdAt: now,
      updatedAt: now,
    }

    writeVersionFile(plan.id, plan.version, body)
    this.db
      .prepare(
        `INSERT INTO plans (id, session_id, agent_id, title, status, version, branch, pr_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.id,
        plan.sessionId,
        plan.agentId,
        plan.title,
        plan.status,
        plan.version,
        null,
        null,
        plan.createdAt,
        plan.updatedAt,
      )

    return plan
  }

  private writeVersion(current: Plan, body: string, reason?: string): Plan {
    const updated: Plan = {
      ...current,
      title: planTitle(body),
      // However far it had got, a rewritten plan is waiting on you again.
      status: 'draft',
      version: current.version + 1,
      updatedAt: Date.now(),
    }

    writeVersionFile(updated.id, updated.version, body)
    this.save(updated)
    this.writeComment(updated, {
      author: agentAuthor(updated),
      tone: 'agent',
      // The agent's own account of why it rewrote the plan beats "Revised
      // the plan — v3." whenever it gave one.
      text: reason?.trim() || revisedLine(updated.version),
    })

    return updated
  }

  private save(plan: Plan): void {
    this.db
      .prepare(
        `UPDATE plans SET title = ?, status = ?, version = ?, branch = ?, pr_url = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        plan.title,
        plan.status,
        plan.version,
        plan.branch ?? null,
        plan.prUrl ?? null,
        plan.updatedAt,
        plan.id,
      )
  }

  private writeComment(plan: Plan, input: NewPlanComment): PlanComment {
    const comment: PlanComment = {
      id: randomUUID(),
      planId: plan.id,
      author: input.author,
      tone: input.tone,
      text: input.text,
      ...(input.quote === undefined ? {} : { quote: input.quote }),
      // Stamped so a note keeps its meaning after the agent rewrites the plan.
      version: plan.version,
      createdAt: Date.now(),
    }

    this.db
      .prepare(
        `INSERT INTO plan_comments (id, plan_id, author, tone, text, quote, version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        comment.id,
        comment.planId,
        comment.author,
        comment.tone,
        comment.text,
        comment.quote ?? null,
        comment.version,
        comment.createdAt,
      )

    return comment
  }
}

/**
 * The plan's opening heading, without the Markdown.
 *
 * `summarisePlan` already picks the line the approval banner shows; a modal
 * header wants the same line but should not read "## ".
 */
export function planTitle(body: string): string {
  const heading = summarisePlan(body)
  if (heading === null) return 'Untitled plan'

  const stripped = heading.replace(/^#+\s*/, '').trim()
  if (stripped === '') return 'Untitled plan'

  // A plan often opens with its structure rather than its subject — Claude's
  // own tend to begin "# Context" — and that names neither the plan nor the
  // branch it will be built on. The first line of prose does.
  if (SECTION_HEADINGS.has(stripped.toLowerCase())) {
    return firstSentence(body) ?? stripped
  }

  return stripped
}

/**
 * Headings that describe a document's parts rather than its subject.
 *
 * Deliberately short: the cost of missing one is a weak title, and the cost
 * of over-reaching is throwing away a real one.
 */
const SECTION_HEADINGS = new Set([
  'context',
  'summary',
  'overview',
  'background',
  'plan',
  'goal',
  'goals',
  'problem',
  'approach',
  'proposal',
])

/** Long enough to say what the plan is, short enough for a modal header. */
const MAX_TITLE = 70

/** The first line of prose: not a heading, a list item, a fence, or blank. */
function firstSentence(body: string): string | null {
  for (const line of body.split('\n')) {
    const text = line.trim()
    if (text === '' || /^(#|[-*+>]|\d+\.|```)/.test(text)) continue

    const sentence = text.split(/(?<=\.)\s/)[0]?.trim() ?? text
    return sentence.length <= MAX_TITLE ? sentence : `${cutAtWord(sentence)}…`
  }

  return null
}

function cutAtWord(text: string): string {
  const cut = text.slice(0, MAX_TITLE)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()
}

function versionPath(planId: string, version: number): string {
  return join(planDir(planId), `v${version}.md`)
}

function writeVersionFile(planId: string, version: number, body: string): void {
  mkdirSync(planDir(planId), { recursive: true })
  writeFileSync(versionPath(planId, version), body, 'utf8')
}

/**
 * Who a revision is logged as.
 *
 * The store has no AgentStore to ask for a display name, and the thread only
 * needs to say this came from the agent rather than from you.
 */
function agentAuthor(plan: Plan): string {
  return plan.agentId
}

function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    title: row.title,
    status: row.status,
    version: row.version,
    ...(row.branch === null ? {} : { branch: row.branch }),
    ...(row.pr_url === null ? {} : { prUrl: row.pr_url }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toComment(row: PlanCommentRow): PlanComment {
  return {
    id: row.id,
    planId: row.plan_id,
    author: row.author,
    tone: row.tone,
    text: row.text,
    ...(row.quote === null ? {} : { quote: row.quote }),
    version: row.version,
    createdAt: row.created_at,
  }
}
