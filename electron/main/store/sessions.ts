import { randomUUID } from 'node:crypto'
import type { Db } from '../db'
import type { Message, Session, SessionOrigin, Status } from '../../../shared/types'

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

  append(message: Omit<Message, 'id' | 'createdAt'> & { id?: string }): Message {
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

  messages(sessionId: string): Message[] {
    const rows = this.db
      .prepare<[string], MessageRow>(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(sessionId)

    return rows.map(toMessage)
  }
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
