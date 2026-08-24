/**
 * Ordered, append-only migrations. Never edit a shipped entry — add a new one.
 * `user_version` tracks how many have run.
 */
export const MIGRATIONS: readonly string[] = [
  // 1 — sessions, messages, approvals, usage
  `
  CREATE TABLE sessions (
    id                TEXT PRIMARY KEY,
    agent_id          TEXT NOT NULL,
    title             TEXT NOT NULL,
    origin            TEXT NOT NULL CHECK (origin IN ('you', 'agent')),
    from_agent_id     TEXT,
    from_session_id   TEXT,
    from_label        TEXT,
    status            TEXT NOT NULL,
    runner_session_id TEXT,
    created_at        INTEGER NOT NULL
  );

  CREATE INDEX ix_sessions_agent ON sessions (agent_id, created_at);

  CREATE TABLE messages (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('text', 'tool', 'spawn', 'handoff')),
    payload    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX ix_messages_session ON messages (session_id, created_at);

  CREATE TABLE approvals (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    tool_name  TEXT NOT NULL,
    command    TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
    created_at INTEGER NOT NULL,
    decided_at INTEGER
  );

  CREATE INDEX ix_approvals_pending ON approvals (session_id, status);

  CREATE TABLE usage (
    session_id    TEXT PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL    NOT NULL DEFAULT 0,
    context_used  REAL    NOT NULL DEFAULT 0
  );
  `,

  // 2 — total tokens, which input + output alone undercounts once a CLI
  // reports cache tokens separately. Existing rows keep their old sum; the
  // cache half of those turns was never recorded and cannot be recovered.
  `
  ALTER TABLE usage ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;
  UPDATE usage SET total_tokens = input_tokens + output_tokens;
  `,

  // 3 — context_used goes. It was a fraction computed when the turn ran, so
  // it went stale the moment an agent's model changed, and it could not say
  // "unknown model" at all. The renderer derives it from total_tokens and the
  // model instead, leaving one place for it to be wrong.
  `
  ALTER TABLE usage DROP COLUMN context_used;
  `,
]
