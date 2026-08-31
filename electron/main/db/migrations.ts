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

  // 4 — the shared task board. Projects are metadata only: a name, a colour
  // and a description, referenced by tasks and sessions but owning neither.
  `
  CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'in_review', 'done')),
    priority    TEXT NOT NULL CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
    assignee_id TEXT,
    project_id  TEXT REFERENCES projects (id) ON DELETE SET NULL,
    labels      TEXT NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE INDEX ix_tasks_status  ON tasks (status, updated_at);
  CREATE INDEX ix_tasks_project ON tasks (project_id);

  CREATE TABLE task_comments (
    id         TEXT PRIMARY KEY,
    task_id    TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    author     TEXT NOT NULL,
    tone       TEXT NOT NULL CHECK (tone IN ('you', 'agent')),
    text       TEXT NOT NULL,
    is_system  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX ix_task_comments_task ON task_comments (task_id, created_at);

  CREATE TABLE counters (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );

  ALTER TABLE sessions ADD COLUMN project_id TEXT;
  `,

  // 5 — backlog becomes a fifth status. It is not a kanban column; it is
  // where work lives before anyone is ready to schedule it.
  //
  // SQLite cannot widen a CHECK, so tasks is rebuilt — and task_comments has
  // to be rebuilt alongside it. Renaming tasks aside rewrites the child's
  // REFERENCES to point at tasks_old, so a rebuild that touched only tasks
  // would leave every comment hanging off the scrap table and lose the lot
  // when it was dropped: DROP TABLE performs an implicit DELETE FROM, which
  // fires ON DELETE CASCADE. Nor can that be switched off from in here —
  // the runner holds a transaction, where foreign_keys is ignored,
  // legacy_alter_table does not prevent the rewrite, and defer_foreign_keys
  // defers checks but not actions. Rebuilding both is what keeps the thread.
  `
  ALTER TABLE tasks RENAME TO tasks_old;
  ALTER TABLE task_comments RENAME TO task_comments_old;

  CREATE TABLE tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done')),
    priority    TEXT NOT NULL CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
    assignee_id TEXT,
    project_id  TEXT REFERENCES projects (id) ON DELETE SET NULL,
    labels      TEXT NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  INSERT INTO tasks SELECT * FROM tasks_old;

  CREATE TABLE task_comments (
    id         TEXT PRIMARY KEY,
    task_id    TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    author     TEXT NOT NULL,
    tone       TEXT NOT NULL CHECK (tone IN ('you', 'agent')),
    text       TEXT NOT NULL,
    is_system  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  INSERT INTO task_comments SELECT * FROM task_comments_old;

  DROP TABLE task_comments_old;
  DROP TABLE tasks_old;

  CREATE INDEX ix_tasks_status       ON tasks (status, updated_at);
  CREATE INDEX ix_tasks_project      ON tasks (project_id);
  CREATE INDEX ix_task_comments_task ON task_comments (task_id, created_at);
  `,

  // 6 — tasks imported from Notion remember the page they came from, and a
  // connection remembers which data source they came out of and how its
  // properties line up with ours.
  //
  // A plain ADD COLUMN: nothing to widen, so none of migration 5's rebuild.
  // The partial index is what makes importing twice update rather than
  // duplicate — without it a second import would deal every page a second
  // task and a second key.
  `
  ALTER TABLE tasks ADD COLUMN notion_page_id TEXT;

  CREATE UNIQUE INDEX ix_tasks_notion ON tasks (notion_page_id)
    WHERE notion_page_id IS NOT NULL;

  CREATE TABLE notion_connections (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    database_id    TEXT NOT NULL,
    data_source_id TEXT NOT NULL,
    mapping        TEXT NOT NULL,
    project_id     TEXT REFERENCES projects (id) ON DELETE SET NULL,
    created_at     INTEGER NOT NULL
  );
  `,

  // 7 — a project can be put away instead of destroyed. NULL means active;
  // an epoch means the moment it was archived, which is also how the archived
  // list sorts. Its tasks and sessions keep pointing at it either way — an
  // archive that lost the work it grouped would be a delete with extra steps.
  //
  // A plain ADD COLUMN, like migration 6: nothing to widen, so none of
  // migration 5's rebuild. Every project that predates the column reads as
  // active, which is what an existing install expects to wake up to.
  `
  ALTER TABLE projects ADD COLUMN archived_at INTEGER;
  `,

  // 8 — a plan an agent proposed, kept as a document you can read and answer.
  //
  // The body is deliberately not a column: it lives at
  // ~/roster/plans/<id>/v<N>.md, because a plan is exactly the kind of thing
  // this app keeps as a file you own — greppable, diffable, and still there
  // when Roster is not running. The row holds only what has to be queryable:
  // which session made it, how far it got, and the pull request it ended in.
  //
  // Both tables hang off the session, so a session that goes takes its plans
  // and their threads with it. A plan about a conversation that no longer
  // exists is not a document, it is a leak.
  `
  CREATE TABLE plans (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    agent_id   TEXT NOT NULL,
    title      TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('draft', 'revising', 'building', 'in_review')),
    version    INTEGER NOT NULL,
    branch     TEXT,
    pr_url     TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX ix_plans_session ON plans (session_id, created_at);

  CREATE TABLE plan_comments (
    id         TEXT PRIMARY KEY,
    plan_id    TEXT NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
    author     TEXT NOT NULL,
    tone       TEXT NOT NULL CHECK (tone IN ('you', 'agent')),
    text       TEXT NOT NULL,
    version    INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX ix_plan_comments_plan ON plan_comments (plan_id, created_at);
  `,

  // 9 — a note can point at the passage it is about.
  //
  // The passage is stored as the text itself rather than as an offset or a
  // line number. The agent rewrites the plan between versions, which is the
  // entire point of the review loop, and any positional anchor would be
  // pointing at the wrong words by the time it was read. A quotation still
  // means what it meant. NULL is a note about the plan as a whole.
  `
  ALTER TABLE plan_comments ADD COLUMN quote TEXT;
  `,
]
