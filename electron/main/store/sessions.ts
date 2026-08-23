import { randomUUID } from 'node:crypto'
import type { Db } from '../db'
import type {
  Message,
  Session,
  SessionOrigin,
  Status,
  TranscriptLine,
} from '../../../shared/types'

interface SessionRow {
  id: string
  agent_id: string
  title: string
  origin: SessionOrigin
  from_agent_id: string | null
  from_session_id: string | null
  from_label: string | null
  status: Status
  runner_session_id: string | null
  created_at: number
}

interface MessageRow {
  id: string
  session_id: string
  kind: Message['kind']
  payload: string
  created_at: number
}

/**
 * Omit over a union collapses it to the common keys, which would silently
 * reject every variant-specific field. Distribute so each member keeps its own.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A message to append: the store assigns id and createdAt. */
export type NewMessage = DistributiveOmit<Message, 'id' | 'createdAt'> & { id?: string }

export interface CreateSessionInput {
  agentId: string
  title: string
  origin: SessionOrigin
  /** Set when another agent opened this session. */
  from?: { agentId: string; sessionId: string; label: string }
}

/**
 * SQLite-backed store for sessions and their messages. Roster is the only
 * writer, so unlike the file-backed stores this one needs no change
 * subscription — callers know when they have written.
 */
export class SessionStore {
  constructor(private readonly db: Db) {}

  create(input: CreateSessionInput): Session {
    const session: Session = {
      id: randomUUID(),
      agentId: input.agentId,
      title: input.title,
      origin: input.origin,
      status: 'idle',
      createdAt: Date.now(),
      ...(input.from
        ? {
            from: input.from.label,
            spawnedFrom: {
              agentId: input.from.agentId,
              sessionId: input.from.sessionId,
              label: input.from.label,
            },
          }
        : {}),
    }

    this.db
      .prepare(
        `INSERT INTO sessions
           (id, agent_id, title, origin, from_agent_id, from_session_id, from_label,
            status, runner_session_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.agentId,
        session.title,
        session.origin,
        input.from?.agentId ?? null,
        input.from?.sessionId ?? null,
        input.from?.label ?? null,
        session.status,
        null,
        session.createdAt,
      )

    return session
  }

  listByAgent(agentId: string): Session[] {
    const rows = this.db
      .prepare<[string], SessionRow>(
        'SELECT * FROM sessions WHERE agent_id = ? ORDER BY created_at ASC',
      )
      .all(agentId)

    return rows.map(toSession)
  }

  /**
   * Every session, grouped by agent. The grid needs all of them at once; a
   * call per card would be a query per agent on every render.
   */
  listAll(): Record<string, Session[]> {
    const rows = this.db
      .prepare<[], SessionRow>('SELECT * FROM sessions ORDER BY agent_id, created_at ASC')
      .all()

    const byAgent: Record<string, Session[]> = {}
    for (const row of rows) (byAgent[row.agent_id] ??= []).push(toSession(row))
    return byAgent
  }

  findById(id: string): Session | null {
    const row = this.db
      .prepare<[string], SessionRow>('SELECT * FROM sessions WHERE id = ?')
      .get(id)

    return row ? toSession(row) : null
  }

  updateStatus(id: string, status: Status): void {
    this.db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, id)
  }

  /** Records the runner's own session id so resume and fork can find it. */
  attachRunnerSession(id: string, runnerSessionId: string): void {
    this.db
      .prepare('UPDATE sessions SET runner_session_id = ? WHERE id = ?')
      .run(runnerSessionId, id)
  }

  rename(id: string, title: string): void {
    this.db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }

  /* ---- messages -------------------------------------------------------- */

  append(message: NewMessage): Message {
    const stored = {
      ...message,
      id: message.id ?? randomUUID(),
      createdAt: Date.now(),
    } as Message

    // The discriminated union is stored whole; only the routing columns are
    // promoted out of the payload.
    const { id, sessionId, kind, createdAt, ...rest } = stored

    this.db
      .prepare(
        'INSERT INTO messages (id, session_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, sessionId, kind, JSON.stringify(rest), createdAt)

    return stored
  }

  /**
   * The last few lines of each agent's most recently active session, for the
   * grid cards. "Most recently active" means the session holding the newest
   * message — not the one most recently created, and not the one the user
   * last clicked.
   *
   * One query for the whole roster: a card per agent would otherwise mean a
   * query per agent on every grid render.
   */
  recentByAgent(limitPerAgent = 4): Record<string, TranscriptLine[]> {
    const rows = this.db
      .prepare<[], RecentRow>(
        `WITH latest AS (
           SELECT s.agent_id, m.session_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY s.agent_id ORDER BY m.created_at DESC, m.rowid DESC
                  ) AS recency
             FROM messages m
             JOIN sessions s ON s.id = m.session_id
         ),
         chosen AS (
           SELECT agent_id, session_id FROM latest WHERE recency = 1
         )
         SELECT c.agent_id, m.kind, m.payload, m.created_at, m.rowid AS row_id
           FROM chosen c
           JOIN messages m ON m.session_id = c.session_id
          ORDER BY c.agent_id, m.created_at DESC, m.rowid DESC`,
      )
      .all()

    const byAgent: Record<string, TranscriptLine[]> = {}

    for (const row of rows) {
      const lines = (byAgent[row.agent_id] ??= [])
      // Rows arrive newest-first; stop once this agent has enough.
      if (lines.length >= limitPerAgent) continue
      lines.push(toLine(row))
    }

    // Flip back to reading order, oldest at the top.
    for (const agentId of Object.keys(byAgent)) byAgent[agentId]!.reverse()
    return byAgent
  }

  messages(sessionId: string): Message[] {
    const rows = this.db
      .prepare<[string], MessageRow>(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(sessionId)

    return rows.map(toMessage)
  }
}

interface RecentRow {
  agent_id: string
  kind: Message['kind']
  payload: string
  created_at: number
  row_id: number
}

/** Collapses a stored message into the one line a grid card shows. */
export function toLine(row: { kind: Message['kind']; payload: string }): TranscriptLine {
  const payload = JSON.parse(row.payload) as Record<string, unknown>

  switch (row.kind) {
    case 'text': {
      // The label column is 52px; the handoff labels by role, not by name,
      // which is what keeps it readable at that width.
      const isUser = payload['role'] === 'user'
      return {
        who: isUser ? 'you' : 'agent',
        role: isUser ? 'user' : 'agent',
        text: firstLine(String(payload['text'] ?? '')),
      }
    }

    case 'tool':
      return {
        who: 'tool',
        role: 'tool',
        text: `${String(payload['tool'] ?? 'tool')} ${String(payload['args'] ?? '')}`.trim(),
      }

    case 'spawn':
      return {
        who: 'spawned',
        role: 'agent',
        text: firstLine(String(payload['text'] ?? '')),
      }

    case 'handoff': {
      const links = Array.isArray(payload['links']) ? payload['links'] : []
      const labels = links
        .map((link) => (isRecord(link) ? String(link['label'] ?? '') : ''))
        .filter((label) => label !== '')
      return {
        who: 'handoff',
        role: 'agent',
        text: labels.length === 0 ? 'opened a session' : `opened ${labels.join(', ')}`,
      }
    }
  }
}

/** A card row is one line; a multi-line message is truncated to its first. */
function firstLine(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '') ?? ''
  return line.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    origin: row.origin,
    status: row.status,
    createdAt: row.created_at,
    ...(row.from_label !== null ? { from: row.from_label } : {}),
    ...(row.from_agent_id !== null && row.from_session_id !== null && row.from_label !== null
      ? {
          spawnedFrom: {
            agentId: row.from_agent_id,
            sessionId: row.from_session_id,
            label: row.from_label,
          },
        }
      : {}),
    ...(row.runner_session_id !== null ? { runnerSessionId: row.runner_session_id } : {}),
  }
}

function toMessage(row: MessageRow): Message {
  const payload = JSON.parse(row.payload) as Record<string, unknown>
  return {
    ...payload,
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind,
    createdAt: row.created_at,
  } as Message
}
