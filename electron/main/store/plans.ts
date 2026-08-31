import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db'
import type { Plan, PlanComment, PlanStatus } from '../../../shared/types'
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
   * the same plan, returned unchanged. Anything else is the next version, and
   * comes back to you as a draft however far the old one had got.
   */
  capture(input: CaptureInput): Plan {
    const current = this.newestFor(input.sessionId)

    if (current && this.body(current.id) === input.body) return current

    const plan = current
      ? this.writeVersion(current, input.body)
      : this.writeFirst(input, input.body)

    this.emit({ type: 'plan-updated', plan })
    return plan
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

  /** The plan a session is currently working on — its most recent. */
  private newestFor(sessionId: string): Plan | null {
    const rows = this.listBySession(sessionId)
    return rows.length === 0 ? null : (rows[rows.length - 1] as Plan)
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

  private writeVersion(current: Plan, body: string): Plan {
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
      text: revisedLine(updated.version),
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
  return stripped === '' ? 'Untitled plan' : stripped
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
