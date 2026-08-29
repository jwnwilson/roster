import type { Db } from '../db'
import { NO_PROJECT, type AgentUsage, type SpendSummary, type Usage } from '../../../shared/types'

interface UsageRow {
  session_id: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
}


/**
 * SQLite-backed usage totals. The runner reports cumulative figures per turn,
 * not deltas, so writes replace rather than accumulate.
 */
export class UsageStore {
  constructor(private readonly db: Db) {}

  forSession(sessionId: string): Usage | null {
    const row = this.db
      .prepare<[string], UsageRow>('SELECT * FROM usage WHERE session_id = ?')
      .get(sessionId)

    return row ? toUsage(row) : null
  }

  /** Totals from the runner are cumulative, so this overwrites. */
  record(usage: Usage): void {
    this.db
      .prepare(
        `INSERT INTO usage
           (session_id, input_tokens, output_tokens, total_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (session_id) DO UPDATE SET
           input_tokens  = excluded.input_tokens,
           output_tokens = excluded.output_tokens,
           total_tokens  = excluded.total_tokens,
           cost_usd      = excluded.cost_usd`,
      )
      .run(
        usage.sessionId,
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
        usage.costUsd,
      )
  }

  /**
   * Totals per agent, across every session it owns — one grouped query rather
   * than one per card. Agents with no usage are absent, not zero rows.
   */
  byAgent(): Record<string, AgentUsage> {
    const rows = this.db
      .prepare<[], { agent_id: string; tokens: number | null; cost: number | null }>(
        `SELECT s.agent_id AS agent_id,
                SUM(u.total_tokens) AS tokens,
                SUM(u.cost_usd)     AS cost
           FROM usage u
           JOIN sessions s ON s.id = u.session_id
          GROUP BY s.agent_id`,
      )
      .all()

    return Object.fromEntries(
      rows.map((row) => [row.agent_id, { tokens: row.tokens ?? 0, costUsd: row.cost ?? 0 }]),
    )
  }

  /**
   * Totals per project, across every session assigned to it.
   *
   * Attributed per session rather than split across an agent's sessions: a
   * session already knows its own project and its own cost, so there is
   * nothing to estimate. Sessions nobody assigned fall under NO_PROJECT.
   */
  byProject(): Record<string, AgentUsage> {
    const rows = this.db
      .prepare<[string], { project_id: string; tokens: number | null; cost: number | null }>(
        `SELECT COALESCE(s.project_id, ?) AS project_id,
                SUM(u.total_tokens) AS tokens,
                SUM(u.cost_usd)     AS cost
           FROM usage u
           JOIN sessions s ON s.id = u.session_id
          GROUP BY project_id`,
      )
      .all(NO_PROJECT)

    return Object.fromEntries(
      rows.map((row) => [row.project_id, { tokens: row.tokens ?? 0, costUsd: row.cost ?? 0 }]),
    )
  }

  /**
   * Both rollups in one trip, for the Spend screen.
   *
   * Composed from the two queries above rather than re-summing: one SQL
   * definition of each figure, so the screen and the grid cards cannot
   * disagree about what an agent has spent.
   */
  summary(): SpendSummary {
    return { byAgent: this.byAgent(), byProject: this.byProject() }
  }
}

function toUsage(row: UsageRow): Usage {
  return {
    sessionId: row.session_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    costUsd: row.cost_usd,
  }
}
