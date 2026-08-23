import type { Db } from '../db'
import type { Usage } from '../../../shared/types'

interface UsageRow {
  session_id: string
  input_tokens: number
  output_tokens: number
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
        `INSERT INTO usage (session_id, input_tokens, output_tokens, cost_usd, context_used)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (session_id) DO UPDATE SET
           input_tokens  = excluded.input_tokens,
           output_tokens = excluded.output_tokens,
           cost_usd      = excluded.cost_usd,
           context_used  = excluded.context_used`,
      )
      .run(
        usage.sessionId,
        usage.inputTokens,
        usage.outputTokens,
        usage.costUsd,
        usage.contextUsed,
      )
  }

  /** Totals across every session an agent owns, for its grid card. */
  forAgent(agentId: string): { tokens: number; costUsd: number } {
    const row = this.db
      .prepare<[string], { tokens: number | null; cost: number | null }>(
        `SELECT SUM(u.input_tokens + u.output_tokens) AS tokens, SUM(u.cost_usd) AS cost
           FROM usage u
           JOIN sessions s ON s.id = u.session_id
          WHERE s.agent_id = ?`,
      )
      .get(agentId)

    return { tokens: row?.tokens ?? 0, costUsd: row?.cost ?? 0 }
  }
}

function toUsage(row: UsageRow): Usage {
  return {
    sessionId: row.session_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    contextUsed: row.context_used,
  }
}
