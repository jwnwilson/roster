import type { Db } from '../db'
import type { AgentUsage, Usage } from '../../../shared/types'

interface UsageRow {
  session_id: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  context_used: number
}

/**
 * Context windows per model, used to fill the rail's progress bar. Like the
 * price table this is data Roster owns; an unknown model reports no bar
 * rather than guessing.
 */
const CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-5': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'gpt-5.6-terra': 400_000,
  'gpt-5.6-luna': 400_000,
  'gpt-5.5': 400_000,
  'gpt-5.4-mini': 400_000,
}

export function contextWindowFor(model: string): number | null {
  return CONTEXT_WINDOWS[model] ?? null
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
           (session_id, input_tokens, output_tokens, total_tokens, cost_usd, context_used)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (session_id) DO UPDATE SET
           input_tokens  = excluded.input_tokens,
           output_tokens = excluded.output_tokens,
           total_tokens  = excluded.total_tokens,
           cost_usd      = excluded.cost_usd,
           context_used  = excluded.context_used`,
      )
      .run(
        usage.sessionId,
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
        usage.costUsd,
        usage.contextUsed,
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
}

function toUsage(row: UsageRow): Usage {
  return {
    sessionId: row.session_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    costUsd: row.cost_usd,
    contextUsed: row.context_used,
  }
}
