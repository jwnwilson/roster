import type { Db } from '../db'
import { NO_PROJECT, type Agent, type AgentUsage, type SpendSummary, type Usage } from '../../../shared/types'
import { estimateCodexCost } from '../costs/codex'

interface UsageRow {
  session_id: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_input_tokens: number
  cost_usd: number
  cost_type: 'actual' | 'estimated' | 'unavailable'
  model: string | null
  rate_table_version: string | null
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
           (session_id, input_tokens, output_tokens, total_tokens, cached_input_tokens, cost_usd, cost_type, model, rate_table_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_id) DO UPDATE SET
           input_tokens  = excluded.input_tokens,
           output_tokens = excluded.output_tokens,
           total_tokens  = excluded.total_tokens,
           cached_input_tokens = excluded.cached_input_tokens,
           cost_usd      = excluded.cost_usd,
           cost_type     = excluded.cost_type,
           model         = excluded.model,
           rate_table_version = excluded.rate_table_version`,
      )
      .run(
        usage.sessionId,
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
        usage.cachedInputTokens ?? 0,
        usage.costUsd,
        usage.costType ?? 'actual',
        usage.model ?? null,
        usage.rateTableVersion ?? null,
      )
  }

  /**
   * Totals per agent, across every session it owns — one grouped query rather
   * than one per card. Agents with no usage are absent, not zero rows.
   */
  byAgent(): Record<string, AgentUsage> {
    const rows = this.db
      .prepare<[], { agent_id: string; tokens: number | null; cost: number | null; estimated: number; unavailable: number }>(
        `SELECT s.agent_id AS agent_id,
                SUM(u.total_tokens) AS tokens,
                SUM(CASE WHEN u.cost_type != 'unavailable' THEN u.cost_usd ELSE 0 END) AS cost,
                MAX(u.cost_type = 'estimated') AS estimated,
                MAX(u.cost_type = 'unavailable') AS unavailable
           FROM usage u
           JOIN sessions s ON s.id = u.session_id
          GROUP BY s.agent_id`,
      )
      .all()

    return Object.fromEntries(
      rows.map((row) => [row.agent_id, {
        tokens: row.tokens ?? 0,
        costUsd: row.cost ?? 0,
        ...(row.estimated === 1 ? { hasEstimatedCost: true } : {}),
        ...(row.unavailable === 1 ? { hasUnavailableCost: true } : {}),
      }]),
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
      .prepare<[string], { project_id: string; tokens: number | null; cost: number | null; estimated: number; unavailable: number }>(
        `SELECT COALESCE(s.project_id, ?) AS project_id,
                SUM(u.total_tokens) AS tokens,
                SUM(CASE WHEN u.cost_type != 'unavailable' THEN u.cost_usd ELSE 0 END) AS cost,
                MAX(u.cost_type = 'estimated') AS estimated,
                MAX(u.cost_type = 'unavailable') AS unavailable
           FROM usage u
           JOIN sessions s ON s.id = u.session_id
          GROUP BY project_id`,
      )
      .all(NO_PROJECT)

    return Object.fromEntries(
      rows.map((row) => [row.project_id, {
        tokens: row.tokens ?? 0,
        costUsd: row.cost ?? 0,
        ...(row.estimated === 1 ? { hasEstimatedCost: true } : {}),
        ...(row.unavailable === 1 ? { hasUnavailableCost: true } : {}),
      }]),
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

  /**
   * Classify old zero-cost rows and retry rows that an earlier rate table
   * could not map. Prefer a model persisted with an unavailable row: an
   * agent's current configuration is only the fallback for pre-provenance
   * history.
   */
  backfillCodex(agents: readonly Agent[]): void {
    const codex = agents.filter((agent) => agent.runner === 'codex')
    const update = this.db.prepare(
      `UPDATE usage SET cost_usd = ?, cost_type = ?, model = ?, rate_table_version = ?
       WHERE session_id = ? AND cost_usd = 0 AND cost_type IN ('actual', 'unavailable')`,
    )
    const transaction = this.db.transaction(() => {
      for (const agent of codex) {
        const rows = this.db.prepare<[string], Pick<UsageRow, 'session_id' | 'input_tokens' | 'output_tokens' | 'cached_input_tokens' | 'model'>>(
          `SELECT u.session_id, u.input_tokens, u.output_tokens, u.cached_input_tokens, u.model
           FROM usage u JOIN sessions s ON s.id = u.session_id
           WHERE s.agent_id = ? AND u.cost_usd = 0 AND u.cost_type IN ('actual', 'unavailable')`,
        ).all(agent.id)
        for (const row of rows) {
          const estimate = estimateCodexCost({
            model: row.model ?? agent.model,
            inputTokens: row.input_tokens,
            cachedInputTokens: row.cached_input_tokens,
            outputTokens: row.output_tokens,
          })
          update.run(estimate.costUsd, estimate.costType, estimate.model, estimate.rateTableVersion, row.session_id)
        }
      }
    })
    transaction()
  }
}

function toUsage(row: UsageRow): Usage {
  return {
    sessionId: row.session_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    cachedInputTokens: row.cached_input_tokens,
    costUsd: row.cost_usd,
    costType: row.cost_type,
    model: row.model,
    rateTableVersion: row.rate_table_version,
  }
}
