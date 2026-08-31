# Task Agent Mentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Writing `@tech-lead …` in a task's comment thread sends the question to that agent in a session attached to the task, and posts its answer back into the thread.

**Architecture:** A shared parser decides what a mention is. A nullable `task_id` column on `sessions` holds the attachment, with a partial unique index enforcing one session per agent per task. A `TaskMentions` coordinator in the main process resolves mentions behind the existing `tasks:comment` handler, opens or resumes the session, starts the turn without awaiting it, and writes the agent's prose back as a task comment. The renderer gains an autocomplete composer and a rail row listing attached sessions.

**Tech Stack:** Electron 30 (main/preload/renderer), React 19, TypeScript (strict), zustand v5, Tailwind v4, better-sqlite3, Vitest (two projects: `main` on node, `renderer` on jsdom), Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-31-task-agent-mentions-design.md`

## Global Constraints

- **Immutability.** Never mutate an object in place; return new objects. This is enforced by review across the codebase and by zustand's reducers.
- **zustand v5.** Any selector that returns a new array or object MUST be read with `useShallow`, or the component re-renders forever.
- **Accessibility-first tests.** Assert with `getByRole` / `getByLabelText` / `findByText`. Never assert on class names or test ids.
- **Agent ids are slugs** — `[a-z0-9-]+`, produced by `AgentStore.slugify`. A mention token is an id, never a display name.
- **The mention token grammar is `@` + `[a-zA-Z0-9][a-zA-Z0-9-]*`**, compared case-insensitively, preceded by start-of-text or a character that is not `[\w@]`.
- **An unknown `@foo` is ordinary text**, never an error.
- **Only comments written by a person dispatch mentions.** Agent-authored comments — including the auto-posted replies — are inert. This is what prevents an unbounded A→B→A loop.
- **A mention never assigns the task**, never changes its status, and writes no History.
- **Coverage thresholds** (`vitest.config.ts`): 80% statements / lines / functions, 70% branches. `electron/main/ipc/index.ts` is excluded from coverage; nothing else added here is.
- **Import aliases:** `@shared/*`, `@main/*` (tests and main), `@/*` (renderer `src/`). Main-process source files use relative paths (`../../../shared/…`), matching the existing files.
- **Commit format:** `<type>: <description>` — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- **Work happens in the worktree** `.claude/worktrees/feat+agent-mentions` on branch `worktree-feat+agent-mentions`. Do not commit to `main`. Run `npm install` in the worktree before the first task if `node_modules` is absent — `postinstall` rebuilds `better-sqlite3` against Electron's ABI.

---

### Task 1: The mention grammar

**Files:**
- Create: `shared/mentions.ts`
- Test: `tests/main/mentions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseMentions(text: string, knownAgentIds: readonly string[]): Mention[]` and `interface Mention { agentId: string; start: number; end: number }`, from `@shared/mentions`. Task 3 uses it to resolve; Task 7 uses the same grammar independently for the composer.

- [ ] **Step 1: Write the failing test**

Create `tests/main/mentions.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { parseMentions } from '@shared/mentions'

const ROSTER = ['tech-lead', 'debugging-agent']

describe('parseMentions', () => {
  test('finds a mention and says where it sits in the text', () => {
    expect(parseMentions('ask @tech-lead about this', ROSTER)).toEqual([
      { agentId: 'tech-lead', start: 4, end: 14 },
    ])
  })

  test('the offsets bracket the token, so a composer can replace it', () => {
    const text = 'ask @tech-lead about this'
    const [mention] = parseMentions(text, ROSTER)

    expect(text.slice(mention?.start, mention?.end)).toBe('@tech-lead')
  })

  test('treats an id nobody has as ordinary text', () => {
    // People write @here and @me without meaning an agent by it.
    expect(parseMentions('ping @nobody about this', ROSTER)).toEqual([])
  })

  test('does not read an email address as a mention', () => {
    expect(parseMentions('noel@tech-lead wrote it', ROSTER)).toEqual([])
  })

  test('matches whatever case it was typed in', () => {
    expect(parseMentions('@Tech-Lead please look', ROSTER)).toMatchObject([
      { agentId: 'tech-lead' },
    ])
  })

  test('mentions one agent once, however often it is named', () => {
    expect(parseMentions('@tech-lead and again @tech-lead', ROSTER)).toHaveLength(1)
  })

  test('keeps two different agents, in the order they were named', () => {
    expect(parseMentions('@debugging-agent then @tech-lead', ROSTER)).toMatchObject([
      { agentId: 'debugging-agent' },
      { agentId: 'tech-lead' },
    ])
  })

  test('finds nothing in text with no mention in it', () => {
    expect(parseMentions('just a comment', ROSTER)).toEqual([])
  })

  test('does not match a longer id by its prefix', () => {
    // Sending the question to an agent the author did not name would be
    // worse than doing nothing.
    expect(parseMentions('@tech-lead-two', ROSTER)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/mentions.test.ts`
Expected: FAIL — `Failed to resolve import "@shared/mentions"`.

- [ ] **Step 3: Write minimal implementation**

Create `shared/mentions.ts`:

```ts
/**
 * Reading `@agent-id` out of a comment.
 *
 * Shared because the composer completes mentions while the main process
 * resolves them, and those two must agree on what counts as one.
 */

export interface Mention {
  agentId: string
  /** Offsets into the source text, so a composer can replace the token. */
  start: number
  end: number
}

/**
 * An agent id is a slug — `AgentStore.slugify` lowercases and collapses
 * everything else to hyphens — so a mention is one word, and needs no greedy
 * matching against multi-word display names.
 *
 * The leading group is what keeps `noel@tech-lead` out: an `@` following a
 * word character belongs to something else. It excludes `@` as well, so the
 * second half of `@a@b` is not read as a mention of its own.
 */
const MENTION = /(^|[^\w@])@([a-zA-Z0-9][a-zA-Z0-9-]*)/g

export function parseMentions(text: string, knownAgentIds: readonly string[]): Mention[] {
  const known = new Set(knownAgentIds)
  const seen = new Set<string>()
  const found: Mention[] = []

  for (const match of text.matchAll(MENTION)) {
    const prefix = match[1] ?? ''
    const token = match[2] ?? ''
    const agentId = token.toLowerCase()

    // An id nobody has is ordinary text, and an agent named twice is asked
    // once.
    if (!known.has(agentId) || seen.has(agentId)) continue
    seen.add(agentId)

    const start = (match.index ?? 0) + prefix.length
    found.push({ agentId, start, end: start + 1 + token.length })
  }

  return found
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/mentions.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/mentions.ts tests/main/mentions.test.ts
git commit -m "feat: read agent mentions out of comment text"
```

---

### Task 2: Attaching a session to a task

**Files:**
- Modify: `electron/main/db/migrations.ts` (append migration 8)
- Modify: `electron/main/store/sessions.ts` (`SessionRow`, `CreateSessionInput`, `create`, `toSession`, add `findByTask` and `linksForTask`)
- Modify: `shared/types.ts` (`Session.taskId`, new `TaskSessionLink`)
- Test: `tests/main/migrations.test.ts` (new describe), `tests/main/sessions.test.ts` (new describe)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface TaskSessionLink { taskId: string; agentId: string; sessionId: string; createdAt: number }` from `@shared/types`.
  - `Session.taskId?: string | null`.
  - `CreateSessionInput.taskId?: string`.
  - `SessionStore.findByTask(taskId: string, agentId: string): Session | null`
  - `SessionStore.linksForTask(taskId: string): TaskSessionLink[]`

- [ ] **Step 1: Write the failing migration test**

Append to `tests/main/migrations.test.ts`:

```ts
describe('migration 8 — a session can be attached to a task', () => {
  /** A database stopped at version 7, as an install from before this would be. */
  function atVersion7() {
    const old = new Database(':memory:')
    old.pragma('foreign_keys = ON')
    for (let i = 0; i < 7; i += 1) old.exec(MIGRATIONS[i] as string)
    old.pragma('user_version = 7')
    return old
  }

  const insertTask = (target: ReturnType<typeof atVersion7>, id: string) =>
    target
      .prepare(
        'INSERT INTO tasks (id, title, status, priority, labels, created_at, updated_at)' +
          ` VALUES ('${id}', 'Fix pool leak', 'todo', 'medium', '[]', 0, 0)`,
      )
      .run()

  const insertSession = (
    target: ReturnType<typeof atVersion7>,
    id: string,
    agent: string,
    task: string | null,
  ) =>
    target
      .prepare(
        `INSERT INTO sessions (id, agent_id, title, origin, status, created_at, task_id)
         VALUES (?, ?, 'x', 'you', 'idle', 0, ?)`,
      )
      .run(id, agent, task)

  test('adds the column to a database that predates it', () => {
    const old = atVersion7()
    expect(
      (old.pragma('table_info(sessions)') as { name: string }[]).map((c) => c.name),
    ).not.toContain('task_id')

    migrate(old)

    expect(
      (old.pragma('table_info(sessions)') as { name: string }[]).map((c) => c.name),
    ).toContain('task_id')
    old.close()
  })

  test('a session that predates the column is attached to nothing', () => {
    const old = atVersion7()
    old.prepare(
      `INSERT INTO sessions (id, agent_id, title, origin, status, created_at)
       VALUES ('s1', 'debugging', 'Session leak on 504', 'you', 'done', 17)`,
    ).run()

    migrate(old)

    expect(old.prepare('SELECT title, task_id FROM sessions').get()).toEqual({
      title: 'Session leak on 504',
      task_id: null,
    })
    old.close()
  })

  test('one agent cannot hold two sessions on the same task', () => {
    const old = atVersion7()
    migrate(old)
    insertTask(old, 'ROS-1')
    insertSession(old, 's1', 'debugging', 'ROS-1')

    // The invariant is the database's, not the coordinator's — two
    // dispatches racing must not produce two sessions for one pair.
    expect(() => insertSession(old, 's2', 'debugging', 'ROS-1')).toThrow()
    old.close()
  })

  test('but two agents can each hold one on the same task', () => {
    const old = atVersion7()
    migrate(old)
    insertTask(old, 'ROS-1')
    insertSession(old, 's1', 'debugging', 'ROS-1')

    expect(() => insertSession(old, 's2', 'review', 'ROS-1')).not.toThrow()
    old.close()
  })

  test('and any number of sessions are attached to no task at all', () => {
    const old = atVersion7()
    migrate(old)

    // A partial index: uniqueness applies to attached sessions, or the
    // second ordinary session would be rejected.
    insertSession(old, 's1', 'debugging', null)
    expect(() => insertSession(old, 's2', 'debugging', null)).not.toThrow()
    old.close()
  })

  test('deleting a task detaches its sessions rather than destroying them', () => {
    const old = atVersion7()
    migrate(old)
    insertTask(old, 'ROS-1')
    insertSession(old, 's1', 'debugging', 'ROS-1')

    old.prepare("DELETE FROM tasks WHERE id = 'ROS-1'").run()

    // Those turns cost money and their usage rows feed the Spend screen.
    // The task goes; the transcript survives, unattached.
    expect(old.prepare('SELECT id, task_id FROM sessions').get()).toEqual({
      id: 's1',
      task_id: null,
    })
    old.close()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/migrations.test.ts -t "migration 8"`
Expected: FAIL — `table sessions has no column named task_id`.

- [ ] **Step 3: Append migration 8**

In `electron/main/db/migrations.ts`, append to the `MIGRATIONS` array, after the `archived_at` entry:

```ts
  // 8 — a session can be attached to a task
  //
  // Mentioning an agent in a task's thread opens a session for it. The
  // column sits beside project_id because it is the same kind of fact: what
  // this session's work is about. One session per agent per task, enforced
  // by the index rather than remembered by the caller, so two dispatches
  // racing cannot produce two.
  //
  // SET NULL rather than CASCADE: deleting a task must not destroy a
  // transcript. Those turns cost real money and their usage rows feed the
  // Spend screen. A plain ADD COLUMN carries the REFERENCES clause because
  // the default is NULL, which is the one case SQLite allows.
  `
  ALTER TABLE sessions ADD COLUMN task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL;

  CREATE UNIQUE INDEX ux_sessions_task_agent
    ON sessions (task_id, agent_id) WHERE task_id IS NOT NULL;
  `,
```

- [ ] **Step 4: Run the migration test to verify it passes**

Run: `npx vitest run tests/main/migrations.test.ts`
Expected: PASS — including the existing "a fresh database lands on the latest version", which reads `MIGRATIONS.length` and needs no change.

- [ ] **Step 5: Write the failing store test**

Append to `tests/main/sessions.test.ts`:

```ts
describe('SessionStore — sessions attached to a task', () => {
  function task(id: string): void {
    db.prepare(
      'INSERT INTO tasks (id, title, status, priority, labels, created_at, updated_at)' +
        ` VALUES ('${id}', 'Fix pool leak', 'todo', 'medium', '[]', 0, 0)`,
    ).run()
  }

  test('records the task a session was opened from', () => {
    task('ROS-1')

    const session = store.create({
      agentId: 'debugging',
      title: 'ROS-1 — Fix pool leak',
      origin: 'you',
      taskId: 'ROS-1',
    })

    expect(session.taskId).toBe('ROS-1')
    expect(store.findById(session.id)?.taskId).toBe('ROS-1')
  })

  test('an ordinary session is attached to no task', () => {
    const session = store.create({ agentId: 'debugging', title: 'x', origin: 'you' })

    expect(session.taskId).toBeNull()
  })

  test('finds the session an agent already has on a task', () => {
    task('ROS-1')
    const created = store.create({
      agentId: 'debugging',
      title: 'ROS-1 — Fix pool leak',
      origin: 'you',
      taskId: 'ROS-1',
    })

    expect(store.findByTask('ROS-1', 'debugging')?.id).toBe(created.id)
  })

  test('finds nothing for an agent that has not been mentioned on it', () => {
    task('ROS-1')

    expect(store.findByTask('ROS-1', 'review')).toBeNull()
  })

  test('lists every session attached to a task, oldest first', () => {
    task('ROS-1')
    const first = store.create({ agentId: 'debugging', title: 'a', origin: 'you', taskId: 'ROS-1' })
    const second = store.create({ agentId: 'review', title: 'b', origin: 'you', taskId: 'ROS-1' })

    expect(store.linksForTask('ROS-1')).toEqual([
      { taskId: 'ROS-1', agentId: 'debugging', sessionId: first.id, createdAt: first.createdAt },
      { taskId: 'ROS-1', agentId: 'review', sessionId: second.id, createdAt: second.createdAt },
    ])
  })

  test('lists nothing for a task nobody has been mentioned on', () => {
    task('ROS-1')

    expect(store.linksForTask('ROS-1')).toEqual([])
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/main/sessions.test.ts -t "attached to a task"`
Expected: FAIL — `store.findByTask is not a function`.

- [ ] **Step 7: Add the shared types**

In `shared/types.ts`, add `taskId` to `Session`, immediately after the `projectId` field:

```ts
  /**
   * The task this session was opened from, when it was opened by mentioning
   * its agent in a task's comment thread. Null for an ordinary session, and
   * null again if that task is later deleted — the transcript outlives it.
   */
  taskId?: string | null
```

And add `TaskSessionLink` immediately after the `TaskComment` interface:

```ts
/**
 * A session opened by mentioning an agent on a task. One per agent per task,
 * which the database enforces.
 *
 * Deliberately minimal — the agent's name and status are derived in the
 * renderer from the roster it already holds.
 */
export interface TaskSessionLink {
  taskId: string
  agentId: string
  sessionId: string
  createdAt: number
}
```

- [ ] **Step 8: Teach the store the column**

In `electron/main/store/sessions.ts`:

Import the new type alongside the others:

```ts
import type {
  Message,
  Session,
  SessionOrigin,
  Status,
  TaskSessionLink,
  TranscriptLine,
} from '../../../shared/types'
```

Add to `SessionRow`, after `project_id`:

```ts
  task_id: string | null
```

Add to `CreateSessionInput`, after `from`:

```ts
  /** The task this session answers, when it was opened by a mention. */
  taskId?: string
```

In `create`, add `taskId: input.taskId ?? null` to the `Session` literal (after `projectId: null`), extend the INSERT column list and its placeholders, and pass the value:

```ts
    this.db
      .prepare(
        `INSERT INTO sessions
           (id, agent_id, title, origin, from_agent_id, from_session_id, from_label,
            status, runner_session_id, task_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.taskId ?? null,
        session.createdAt,
      )
```

Add the two reads, after `setProject`:

```ts
  /**
   * The session an agent already has on a task, if it has one.
   *
   * This is what makes a second mention continue the conversation rather
   * than start a new one. The pair is unique by index, so there is at most
   * one row to find.
   */
  findByTask(taskId: string, agentId: string): Session | null {
    const row = this.db
      .prepare<[string, string], SessionRow>(
        'SELECT * FROM sessions WHERE task_id = ? AND agent_id = ?',
      )
      .get(taskId, agentId)

    return row ? toSession(row) : null
  }

  /** Every session attached to a task, for the detail panel's rail. */
  linksForTask(taskId: string): TaskSessionLink[] {
    const rows = this.db
      .prepare<[string], SessionRow>(
        'SELECT * FROM sessions WHERE task_id = ? ORDER BY created_at ASC',
      )
      .all(taskId)

    return rows.map((row) => ({
      taskId,
      agentId: row.agent_id,
      sessionId: row.id,
      createdAt: row.created_at,
    }))
  }
```

In `toSession`, add after `projectId: row.project_id`:

```ts
    taskId: row.task_id,
```

- [ ] **Step 9: Run both test files to verify they pass**

Run: `npx vitest run tests/main/sessions.test.ts tests/main/migrations.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the whole main project and typecheck**

Run: `npm run test:main && npm run typecheck`
Expected: PASS. `Session.taskId` is optional, so no existing construction of a `Session` breaks.

- [ ] **Step 11: Commit**

```bash
git add electron/main/db/migrations.ts electron/main/store/sessions.ts shared/types.ts \
        tests/main/migrations.test.ts tests/main/sessions.test.ts
git commit -m "feat: attach a session to the task it was opened from"
```

---

### Task 3: The coordinator opens and resumes sessions

**Files:**
- Create: `electron/main/sessions/mentions.ts`
- Test: `tests/main/taskMentions.test.ts`

**Interfaces:**
- Consumes: `parseMentions` (Task 1); `SessionStore.findByTask`, `SessionStore.create({ taskId })`, `TaskSessionLink` (Task 2).
- Produces:
  - `interface MentionRunner { send(sessionId: string, prompt: string): Promise<void> }`
  - `class TaskMentions` with constructor `(roster: () => Agent[], sessions: SessionStore, tasks: TaskStore, runner: MentionRunner, onAttached?: (link: TaskSessionLink) => void)` and method `dispatch(taskId: string, text: string): Promise<void>`
  - `briefFor(task: Task, thread: readonly TaskComment[]): string`

  Task 4 adds the reply behaviour to this same class. Task 5 constructs it.

- [ ] **Step 1: Write the failing test**

Create `tests/main/taskMentions.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { SessionStore } from '@main/store/sessions'
import { TaskStore } from '@main/store/tasks'
import { TaskMentions } from '@main/sessions/mentions'
import type { Agent, TaskSessionLink } from '@shared/types'

function anAgent(id: string, name: string): Agent {
  return {
    id,
    name,
    runner: 'claude',
    model: 'claude-opus-5',
    cwd: '/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: 'Reproduce before you fix.',
    skills: [],
    mcpServers: [],
    hidden: false,
    status: 'idle',
  }
}

const ROSTER = [anAgent('tech-lead', 'Tech Lead'), anAgent('debugging', 'Debugging Agent')]

let db: Db
let sessions: SessionStore
let tasks: TaskStore
let send: ReturnType<typeof vi.fn>
let attached: TaskSessionLink[]
let mentions: TaskMentions

beforeEach(() => {
  db = openDatabase(':memory:')
  sessions = new SessionStore(db)
  tasks = new TaskStore(db, (id) => ROSTER.find((a) => a.id === id)?.name ?? null)
  send = vi.fn().mockResolvedValue(undefined)
  attached = []
  mentions = new TaskMentions(
    () => ROSTER,
    sessions,
    tasks,
    { send: send as unknown as (s: string, p: string) => Promise<void> },
    (link) => attached.push(link),
  )
})

/** A task with a thread, as the handler would have left it. */
function aTask(title = 'Fix connection pool leak'): string {
  const task = tasks.create({ title, description: 'It leaks on 504.' })
  return task.id
}

describe('TaskMentions.dispatch — opening a session', () => {
  test('opens a session for the agent that was mentioned', async () => {
    const id = aTask()

    await mentions.dispatch(id, '@tech-lead what do you make of this?')

    const session = sessions.findByTask(id, 'tech-lead')
    expect(session).not.toBeNull()
    expect(session?.agentId).toBe('tech-lead')
  })

  test('titles the session after the task, so its tab says what it is', async () => {
    const id = aTask('Fix connection pool leak')

    await mentions.dispatch(id, '@tech-lead look at this')

    expect(sessions.findByTask(id, 'tech-lead')?.title).toBe(
      `${id} — Fix connection pool leak`,
    )
  })

  test('opens the transcript with the task, so the agent is not answering blind', async () => {
    const id = aTask()
    tasks.comment(id, { author: 'You', tone: 'you', text: 'seen twice today' })

    await mentions.dispatch(id, '@tech-lead what do you make of this?')

    const session = sessions.findByTask(id, 'tech-lead')
    const [first] = sessions.messages(session?.id ?? '')
    expect(first?.kind).toBe('spawn')
    const brief = first?.kind === 'spawn' ? first.text : ''
    expect(brief).toContain(id)
    expect(brief).toContain('Fix connection pool leak')
    expect(brief).toContain('It leaks on 504.')
    expect(brief).toContain('seen twice today')
  })

  test('starts the turn with the comment that mentioned it', async () => {
    const id = aTask()

    await mentions.dispatch(id, '@tech-lead what do you make of this?')

    const session = sessions.findByTask(id, 'tech-lead')
    expect(send).toHaveBeenCalledWith(
      session?.id,
      `On ${id}: @tech-lead what do you make of this?`,
    )
  })

  test('announces the attachment, so an open panel can show it', async () => {
    const id = aTask()

    await mentions.dispatch(id, '@tech-lead hello')

    expect(attached).toEqual([
      {
        taskId: id,
        agentId: 'tech-lead',
        sessionId: sessions.findByTask(id, 'tech-lead')?.id,
        createdAt: expect.any(Number),
      },
    ])
  })
})

describe('TaskMentions.dispatch — resuming a session', () => {
  test('mentioning the same agent again continues its session', async () => {
    const id = aTask()
    await mentions.dispatch(id, '@tech-lead first question')
    const first = sessions.findByTask(id, 'tech-lead')?.id

    await mentions.dispatch(id, '@tech-lead second question')

    expect(sessions.findByTask(id, 'tech-lead')?.id).toBe(first)
    expect(send).toHaveBeenLastCalledWith(first, `On ${id}: @tech-lead second question`)
  })

  test('does not open the transcript a second time', async () => {
    const id = aTask()
    await mentions.dispatch(id, '@tech-lead first question')
    await mentions.dispatch(id, '@tech-lead second question')

    const session = sessions.findByTask(id, 'tech-lead')
    const spawns = sessions
      .messages(session?.id ?? '')
      .filter((message) => message.kind === 'spawn')
    expect(spawns).toHaveLength(1)
  })

  test('announces the attachment only when one is made', async () => {
    const id = aTask()
    await mentions.dispatch(id, '@tech-lead first')
    await mentions.dispatch(id, '@tech-lead second')

    expect(attached).toHaveLength(1)
  })

  test('a second agent gets its own session, not the first one', async () => {
    const id = aTask()
    await mentions.dispatch(id, '@tech-lead have a look')

    await mentions.dispatch(id, '@debugging you too')

    const lead = sessions.findByTask(id, 'tech-lead')
    const debugging = sessions.findByTask(id, 'debugging')
    expect(debugging?.id).not.toBe(lead?.id)
    expect(sessions.linksForTask(id)).toHaveLength(2)
  })

  test('asks both agents named in one comment', async () => {
    const id = aTask()

    await mentions.dispatch(id, '@tech-lead and @debugging, thoughts?')

    expect(sessions.linksForTask(id)).toHaveLength(2)
    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('TaskMentions.dispatch — when it should do nothing', () => {
  test('a comment with no mention starts no turn', async () => {
    const id = aTask()

    await mentions.dispatch(id, 'just thinking out loud')

    expect(send).not.toHaveBeenCalled()
    expect(sessions.linksForTask(id)).toEqual([])
  })

  test('an id nobody has starts no turn', async () => {
    const id = aTask()

    await mentions.dispatch(id, '@nobody are you there')

    expect(send).not.toHaveBeenCalled()
  })

  test('a task that no longer exists starts no turn', async () => {
    await mentions.dispatch('ROS-404', '@tech-lead hello')

    expect(send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/taskMentions.test.ts`
Expected: FAIL — `Failed to resolve import "@main/sessions/mentions"`.

- [ ] **Step 3: Write the coordinator**

Create `electron/main/sessions/mentions.ts`:

```ts
import { parseMentions } from '../../../shared/mentions'
import { taskPriorityLabel, taskStatusLabel } from '../../../shared/tasks'
import type {
  Agent,
  Session,
  Task,
  TaskComment,
  TaskSessionLink,
} from '../../../shared/types'
import type { SessionStore } from '../store/sessions'
import type { TaskStore } from '../store/tasks'

/**
 * The slice of SessionManager this needs.
 *
 * Narrow on purpose: a turn can then be driven in a test by a spy, without
 * standing up a runner or the SDK.
 */
export interface MentionRunner {
  send(sessionId: string, prompt: string): Promise<void>
}

/**
 * Mentioning an agent in a task's comment thread.
 *
 * The mechanism is `SessionManager.handOff` with a task as the origin: a
 * session is opened on the mentioned agent, its transcript opens with a
 * brief saying why it exists, and the turn runs. Mentioning the same agent
 * again continues that session, so it still remembers what it was asked
 * about this task an hour ago.
 *
 * Only a comment written by a person reaches here. An agent's own comments
 * are inert, which is what stops one agent's answer mentioning another and
 * looping forever.
 */
export class TaskMentions {
  constructor(
    /** A function, not the store: the roster lives in agent.toml, and reloads. */
    private readonly roster: () => Agent[],
    private readonly sessions: SessionStore,
    private readonly tasks: TaskStore,
    private readonly runner: MentionRunner,
    private readonly onAttached: (link: TaskSessionLink) => void = () => {},
  ) {}

  /**
   * Sends a comment to every agent it mentions.
   *
   * The returned promise settles when every turn has finished, which is why
   * the IPC handler discards it with `void` — posting a comment must not
   * wait for an agent to think. Tests await it.
   */
  async dispatch(taskId: string, text: string): Promise<void> {
    const task = this.tasks.findById(taskId)
    if (!task) return

    const roster = this.roster()
    const mentioned = parseMentions(
      text,
      roster.map((agent) => agent.id),
    )
    if (mentioned.length === 0) return

    await Promise.all(
      mentioned.map((mention) => {
        const agent = roster.find((candidate) => candidate.id === mention.agentId)
        return agent ? this.ask(task, agent, text) : Promise.resolve()
      }),
    )
  }

  private async ask(task: Task, agent: Agent, comment: string): Promise<void> {
    const session = this.sessions.findByTask(task.id, agent.id) ?? this.open(task, agent)

    // The key leads, so a resumed session knows which task is being asked
    // about without re-reading the brief.
    await this.runner.send(session.id, `On ${task.id}: ${comment}`)
  }

  private open(task: Task, agent: Agent): Session {
    const session = this.sessions.create({
      agentId: agent.id,
      title: `${task.id} — ${task.title}`,
      // Always 'you': by design only a person's comment dispatches.
      origin: 'you',
      taskId: task.id,
    })

    // The transcript opens by saying why it exists, exactly as a handoff's
    // does. `to` is omitted — a SessionRef points at an agent and a session,
    // and this one's origin is a task, which `session.taskId` already holds.
    this.sessions.append({
      sessionId: session.id,
      kind: 'spawn',
      from: 'You',
      text: briefFor(task, this.tasks.comments(task.id)),
    })

    this.onAttached({
      taskId: task.id,
      agentId: agent.id,
      sessionId: session.id,
      createdAt: session.createdAt,
    })

    return session
  }
}

/**
 * What a mentioned agent is told when its session opens.
 *
 * Exported because it is the whole value of the first message and deserves
 * its own tests. History lines are left out: the agent was asked a question,
 * not handed an audit log.
 */
export function briefFor(task: Task, thread: readonly TaskComment[]): string {
  const lines = [
    `You have been mentioned on ${task.id} — ${task.title}.`,
    '',
    `Status: ${taskStatusLabel(task.status)}`,
    `Priority: ${taskPriorityLabel(task.priority)}`,
    '',
    task.description.trim() === '' ? '(no description)' : task.description,
  ]

  const written = thread.filter((entry) => !entry.isSystem)
  if (written.length > 0) {
    lines.push('', 'The thread so far:')
    for (const entry of written) lines.push(`- ${entry.author}: ${entry.text}`)
  }

  lines.push('', 'Answer here. Your reply is posted back to the task.')
  return lines.join('\n')
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/main/taskMentions.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/main/sessions/mentions.ts tests/main/taskMentions.test.ts
git commit -m "feat: open a session on the agent a task comment mentions"
```

---

### Task 4: The answer comes back to the thread

**Files:**
- Modify: `electron/main/sessions/mentions.ts` (`ask`, plus two helpers)
- Test: `tests/main/taskMentions.test.ts` (new describes)

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: no new exports. `TaskMentions.ask` now writes a `TaskComment` with `tone: 'agent'` after each turn. Task 6's reducer and Task 8's thread render it through the existing `comment` event.

- [ ] **Step 1: Write the failing test**

Append to `tests/main/taskMentions.test.ts`:

```ts
/** What people actually wrote, in order — History is a different tab. */
function written(taskId: string): { author: string; text: string }[] {
  return tasks
    .comments(taskId)
    .filter((entry) => !entry.isSystem)
    .map((entry) => ({ author: entry.author, text: entry.text }))
}

/** Drives a turn that records prose, the way a real run would. */
function replyWith(...chunks: string[]): void {
  send.mockImplementation(async (sessionId: string) => {
    for (const text of chunks) {
      sessions.append({
        sessionId,
        kind: 'text',
        role: 'assistant',
        who: 'Tech Lead',
        text,
      })
    }
  })
}

describe('TaskMentions.dispatch — the answer', () => {
  test('posts the agent's reply into the thread', async () => {
    const id = aTask()
    replyWith('It is the retry path holding the connection.')

    await mentions.dispatch(id, '@tech-lead what do you make of this?')

    expect(written(id)).toContainEqual({
      author: 'Tech Lead',
      text: 'It is the retry path holding the connection.',
    })
  })

  test('joins the whole turn, not just its last paragraph', async () => {
    const id = aTask()
    // A turn flushes buffered prose in chunks, so one answer is routinely
    // several messages.
    replyWith('First, the retry path.', 'Second, the pool is never drained.')

    await mentions.dispatch(id, '@tech-lead why?')

    expect(written(id)).toContainEqual({
      author: 'Tech Lead',
      text: 'First, the retry path.\n\nSecond, the pool is never drained.',
    })
  })

  test('quotes only this turn, not the answer to the last question', async () => {
    const id = aTask()
    replyWith('An answer about the pool.')
    await mentions.dispatch(id, '@tech-lead first question')

    replyWith('An answer about the retries.')
    await mentions.dispatch(id, '@tech-lead second question')

    const answers = written(id).filter((entry) => entry.author === 'Tech Lead')
    expect(answers).toEqual([
      { author: 'Tech Lead', text: 'An answer about the pool.' },
      { author: 'Tech Lead', text: 'An answer about the retries.' },
    ])
  })

  test('ignores tool calls, which are not an answer', async () => {
    const id = aTask()
    send.mockImplementation(async (sessionId: string) => {
      sessions.append({
        sessionId,
        kind: 'tool',
        tool: 'Read',
        args: 'pool.ts',
        output: '…',
        isError: false,
      })
      sessions.append({
        sessionId,
        kind: 'text',
        role: 'assistant',
        who: 'Tech Lead',
        text: 'The retry path.',
      })
    })

    await mentions.dispatch(id, '@tech-lead why?')

    expect(written(id)).toContainEqual({ author: 'Tech Lead', text: 'The retry path.' })
  })

  test('says so in the thread when the turn produced no prose', async () => {
    const id = aTask()
    send.mockResolvedValue(undefined)

    await mentions.dispatch(id, '@tech-lead why?')

    // A mention must never silently produce nothing.
    const answers = written(id).filter((entry) => entry.author === 'Tech Lead')
    expect(answers).toHaveLength(1)
    expect(answers[0]?.text).toContain('nothing to quote')
  })
})

describe('TaskMentions.dispatch — when the turn fails', () => {
  test('reports the reason in the thread', async () => {
    const id = aTask()
    send.mockRejectedValue(new Error('no runner is registered for "claude"'))

    await mentions.dispatch(id, '@tech-lead why?')

    expect(written(id)).toContainEqual({
      author: 'Tech Lead',
      text: 'Couldn't answer — no runner is registered for "claude"',
    })
  })

  test('says plainly when the agent is simply busy', async () => {
    const id = aTask()
    send.mockRejectedValue(new Error('this session is already running'))

    await mentions.dispatch(id, '@tech-lead and another thing')

    // Raw, that message reads like a Roster bug rather than an agent that
    // has not finished the last question.
    expect(written(id)).toContainEqual({
      author: 'Tech Lead',
      text: 'Tech Lead is still working on your last question.',
    })
  })

  test('one agent failing does not stop the other from answering', async () => {
    const id = aTask()
    send.mockImplementation(async (sessionId: string) => {
      const session = sessions.findById(sessionId)
      if (session?.agentId === 'tech-lead') throw new Error('boom')
      sessions.append({
        sessionId,
        kind: 'text',
        role: 'assistant',
        who: 'Debugging Agent',
        text: 'I had a look.',
      })
    })

    await mentions.dispatch(id, '@tech-lead @debugging thoughts?')

    expect(written(id)).toContainEqual({
      author: 'Debugging Agent',
      text: 'I had a look.',
    })
    expect(written(id)).toContainEqual({
      author: 'Tech Lead',
      text: 'Couldn't answer — boom',
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/taskMentions.test.ts -t "the answer"`
Expected: FAIL — the thread contains only the mention comment; no agent comment is written.

- [ ] **Step 3: Implement the reply**

In `electron/main/sessions/mentions.ts`, replace `ask` with:

```ts
  private async ask(task: Task, agent: Agent, comment: string): Promise<void> {
    const session = this.sessions.findByTask(task.id, agent.id) ?? this.open(task, agent)

    // What the session held before this turn, so the reply is this turn's
    // prose and not the answer to the last question.
    const before = this.sessions.messages(session.id).length

    try {
      // The key leads, so a resumed session knows which task is being asked
      // about without re-reading the brief.
      await this.runner.send(session.id, `On ${task.id}: ${comment}`)
    } catch (cause) {
      this.post(task.id, agent, failureFor(agent, cause))
      return
    }

    const reply = this.replySince(session.id, before)
    this.post(
      task.id,
      agent,
      reply === ''
        ? `Answered in "${session.title}" — nothing to quote here.`
        : reply,
    )
  }

  /**
   * The agent's prose from this turn, joined.
   *
   * Joined rather than reduced to the last message because SessionManager
   * flushes buffered text in chunks — taking only the final one would post
   * the last paragraph of an answer and drop the rest. Tool calls are left
   * out: they are how the answer was reached, not the answer.
   */
  private replySince(sessionId: string, before: number): string {
    return this.sessions
      .messages(sessionId)
      .slice(before)
      .flatMap((message) =>
        message.kind === 'text' && message.role === 'assistant' ? [message.text.trim()] : [],
      )
      .filter((text) => text !== '')
      .join('\n\n')
  }

  private post(taskId: string, agent: Agent, text: string): void {
    this.tasks.comment(taskId, { author: agent.name, tone: 'agent', text })
  }
```

And add, beside `briefFor` at the bottom of the file:

```ts
/** SessionManager's wording for a session that has not finished its turn. */
const ALREADY_RUNNING = 'this session is already running'

/**
 * Why an answer did not arrive, as a sentence for the thread.
 *
 * An asynchronous failure can no longer reject the IPC call, so this is the
 * only place it can surface.
 */
function failureFor(agent: Agent, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)

  return message === ALREADY_RUNNING
    ? `${agent.name} is still working on your last question.`
    : `Couldn't answer — ${message}`
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/main/taskMentions.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Run the whole main project**

Run: `npm run test:main && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/main/sessions/mentions.ts tests/main/taskMentions.test.ts
git commit -m "feat: post a mentioned agent's answer back to the task"
```

---

### Task 5: Wiring it through IPC

**Files:**
- Modify: `shared/ipc.ts` (channel, `RosterApi.tasks.sessions`, `TaskEventPayload`)
- Modify: `electron/preload/index.ts` (`tasks.sessions`)
- Modify: `electron/main/ipc/index.ts` (construct `TaskMentions`, new handler, dispatch from the comment handler)
- Modify: `tests/renderer/rosterApi.ts` (stub the new method)

**Interfaces:**
- Consumes: `TaskMentions` (Tasks 3–4), `SessionStore.linksForTask` and `TaskSessionLink` (Task 2).
- Produces:
  - `window.roster.tasks.sessions(taskId: string): Promise<TaskSessionLink[]>`
  - `TaskEventPayload` variant `{ type: 'task-session'; taskId: string; link: TaskSessionLink }`
  - Channel constant `CHANNELS.tasksSessions === 'tasks:sessions'`

  Tasks 6 and 9 consume both.

> `electron/main/ipc/index.ts` is excluded from coverage by `vitest.config.ts`, so this task has no automated test of its own — the same call the codebase already makes for `projectsDelete`. It is verified by the renderer stub type-checking and by the manual run in Task 10.

- [ ] **Step 1: Extend the shared contract**

In `shared/ipc.ts`:

Add `TaskSessionLink` to the type import from `./types`.

Add to the `tasks` block of `RosterApi`, after `comment`:

```ts
    /**
     * Sessions attached to this task — one per agent that has been mentioned
     * on it, oldest first.
     */
    sessions(taskId: string): Promise<TaskSessionLink[]>
```

Add the event variant to `TaskEventPayload`, after the `comment` one:

```ts
  | { type: 'task-session'; taskId: string; link: TaskSessionLink }
```

Add the channel, beside the other task channels:

```ts
  tasksSessions: 'tasks:sessions',
```

- [ ] **Step 2: Extend the preload bridge**

In `electron/preload/index.ts`, add to the `tasks` block, after `comment`:

```ts
    sessions: (taskId) => ipcRenderer.invoke(CHANNELS.tasksSessions, taskId),
```

- [ ] **Step 3: Stub it for renderer tests**

In `tests/renderer/rosterApi.ts`, add to the `tasks` block:

```ts
      sessions: vi.fn().mockResolvedValue([]),
```

- [ ] **Step 4: Construct the coordinator**

In `electron/main/ipc/index.ts`:

Add the import beside the other session imports:

```ts
import { TaskMentions } from '../sessions/mentions'
```

Add the module-level handle beside `manager`:

```ts
let mentions: TaskMentions | null = null
```

Add the accessor beside `requireManager`:

```ts
function requireMentions(): TaskMentions {
  if (!mentions) throw new Error('task mentions are not initialised')
  return mentions
}
```

Construct it immediately after `manager.subscribe(...)` and the existing
`taskStore.subscribe(...)` bridge:

```ts
  // Mentioning an agent in a task's thread opens a session for it. The
  // attachment is broadcast on the board's own channel, since the task
  // detail panel is what shows it.
  mentions = new TaskMentions(
    () => agentStore.findAll(),
    sessionStore,
    taskStore,
    manager,
    (link) => broadcast(CHANNELS.tasksEvent, { type: 'task-session', taskId: link.taskId, link }),
  )
```

- [ ] **Step 5: Add the read handler and dispatch from the comment handler**

In `electron/main/ipc/index.ts`, replace the `tasksComment` handler and add one beside it:

```ts
  ipcMain.handle(CHANNELS.tasksComment, (_e, taskId: string, text: string) => {
    const comment = requireTasks().comment(taskId, {
      author: YOU.name,
      tone: YOU.tone,
      text,
    })

    // Deliberately not awaited: a turn runs for as long as the agent takes,
    // and posting a comment must not wait for it. A failure reaches the
    // thread as a comment rather than as a rejection here.
    void requireMentions().dispatch(taskId, text)

    return comment
  })

  ipcMain.handle(CHANNELS.tasksSessions, (_e, taskId: string) =>
    requireSessions().linksForTask(taskId),
  )
```

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: PASS. The `RosterApi` change would fail both tsconfigs if the preload or the test stub had been missed.

- [ ] **Step 7: Commit**

```bash
git add shared/ipc.ts electron/preload/index.ts electron/main/ipc/index.ts tests/renderer/rosterApi.ts
git commit -m "feat: dispatch task mentions and expose attached sessions over IPC"
```

---

### Task 6: The store holds attached sessions

**Files:**
- Modify: `src/state/store.ts` (state field, default, action, `NO_TASK_SESSIONS`, two reducer cases)
- Test: `tests/renderer/store.test.ts`

**Interfaces:**
- Consumes: `TaskSessionLink` (Task 2), the `task-session` event (Task 5).
- Produces:
  - `RosterState.taskSessions: Record<string, TaskSessionLink[]>`
  - `setTaskSessions(taskId: string, links: TaskSessionLink[]): void`
  - `NO_TASK_SESSIONS: readonly TaskSessionLink[]`

  Task 9 reads all three.

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer/store.test.ts` (follow that file's existing `INITIAL` / `beforeEach` idiom; if it defines its own helpers for building state, reuse them):

```ts
describe('reduceTaskEvent — sessions attached to a task', () => {
  const LINK = {
    taskId: 'ROS-1',
    agentId: 'tech-lead',
    sessionId: 'session-1',
    createdAt: 1_700_000_000_000,
  }

  test('adds an attachment to a task whose panel is open', () => {
    useRoster.setState({ taskSessions: { 'ROS-1': [] } })

    useRoster.getState().applyTaskEvent({ type: 'task-session', taskId: 'ROS-1', link: LINK })

    expect(useRoster.getState().taskSessions['ROS-1']).toEqual([LINK])
  })

  test('applying the same attachment twice changes nothing', () => {
    useRoster.setState({ taskSessions: { 'ROS-1': [LINK] } })

    useRoster.getState().applyTaskEvent({ type: 'task-session', taskId: 'ROS-1', link: LINK })

    expect(useRoster.getState().taskSessions['ROS-1']).toEqual([LINK])
  })

  test('ignores a task whose panel was never opened', () => {
    // Nothing to append to — the list is read in full when it is opened.
    useRoster.getState().applyTaskEvent({ type: 'task-session', taskId: 'ROS-9', link: LINK })

    expect(useRoster.getState().taskSessions['ROS-9']).toBeUndefined()
  })

  test('forgets a deleted task's attachments', () => {
    useRoster.setState({ tasks: [], taskSessions: { 'ROS-1': [LINK] } })

    useRoster.getState().applyTaskEvent({ type: 'task-deleted', taskId: 'ROS-1' })

    expect(useRoster.getState().taskSessions['ROS-1']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/renderer/store.test.ts -t "attached to a task"`
Expected: FAIL — `taskSessions` is undefined.

- [ ] **Step 3: Add the state**

In `src/state/store.ts`:

Add `TaskSessionLink` to the type import from `@shared/types`.

Add the field beside `taskComments` in the `RosterState` interface:

```ts
  /** Sessions attached to a task, keyed by task id. Loaded when it is opened. */
  taskSessions: Record<string, TaskSessionLink[]>
```

Add the action, beside `setTaskComments`:

```ts
  setTaskSessions(taskId: string, links: TaskSessionLink[]): void
```

Add the default, beside `taskComments: {}`:

```ts
  taskSessions: {},
```

Add the implementation, beside `setTaskComments`:

```ts
  setTaskSessions: (taskId, links) =>
    set((s) => ({ taskSessions: { ...s.taskSessions, [taskId]: links } })),
```

Add the frozen empty list beside `NO_COMMENTS`:

```ts
/** A stable empty list, so a task with no sessions does not re-render forever. */
export const NO_TASK_SESSIONS: readonly TaskSessionLink[] = Object.freeze([])
```

- [ ] **Step 4: Add the reducer cases**

In `reduceTaskEvent`, add `taskSessions` to the `task-deleted` case:

```ts
    case 'task-deleted':
      return {
        tasks: state.tasks.filter((task) => task.id !== event.taskId),
        // Nothing left to show, so close the modal rather than leave it
        // pointing at a task that no longer exists.
        ...(state.openTaskId === event.taskId ? { openTaskId: null } : {}),
        taskComments: withoutKey(state.taskComments, event.taskId),
        taskSessions: withoutKey(state.taskSessions, event.taskId),
      }
```

And add the new case, after `comment`:

```ts
    case 'task-session': {
      const existing = state.taskSessions[event.taskId]
      // A panel that was never opened has nothing to append to — the list
      // will be read in full when it is.
      if (existing === undefined) return {}
      if (existing.some((link) => link.sessionId === event.link.sessionId)) return {}

      return {
        taskSessions: {
          ...state.taskSessions,
          [event.taskId]: [...existing, event.link],
        },
      }
    }
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run tests/renderer/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/state/store.ts tests/renderer/store.test.ts
git commit -m "feat: hold a task's attached sessions in the store"
```

---

### Task 7: The mention composer

**Files:**
- Create: `src/components/MentionInput.tsx`
- Test: `tests/renderer/MentionInput.test.tsx`

**Interfaces:**
- Consumes: `StatusDot` from `@/components/primitives`.
- Produces: `MentionInput` (a controlled text input with an agent popover) and `activeMention(text: string, caret: number): { query: string; start: number } | null`. Task 8 mounts it.

```ts
interface MentionInputProps {
  value: string
  onChange: (value: string) => void
  /** Enter, when no agent list is open. */
  onSubmit: () => void
  agents: readonly Agent[]
  /** agentId -> the status its dot shows. */
  statuses: Record<string, Status>
  ariaLabel: string
  placeholder?: string
}
```

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/MentionInput.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { useState } from 'react'
import { MentionInput } from '@/components/MentionInput'
import { anAgent } from './factories'

const AGENTS = [
  anAgent({ id: 'tech-lead', name: 'Tech Lead' }),
  anAgent({ id: 'debugging', name: 'Debugging Agent' }),
]

/** Controlled by a host, as the thread controls it. */
function Host({ onSubmit = () => {} }: { onSubmit?: () => void }) {
  const [value, setValue] = useState('')
  return (
    <MentionInput
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      agents={AGENTS}
      statuses={{ 'tech-lead': 'idle', debugging: 'running' }}
      ariaLabel="Add a comment"
      placeholder="Add a comment"
    />
  )
}

describe('MentionInput', () => {
  test('offers the roster once an @ is typed', async () => {
    const user = userEvent.setup()
    render(<Host />)

    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), 'ask @')

    expect(screen.getByRole('option', { name: /Tech Lead/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Debugging Agent/ })).toBeInTheDocument()
  })

  test('offers nothing until there is an @ to complete', () => {
    render(<Host />)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  test('narrows the list by id', async () => {
    const user = userEvent.setup()
    render(<Host />)

    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), '@tech')

    expect(screen.getByRole('option', { name: /Tech Lead/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Debugging Agent/ })).not.toBeInTheDocument()
  })

  test('narrows the list by name too, since the id is not what you remember', async () => {
    const user = userEvent.setup()
    render(<Host />)

    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), '@lead')

    expect(screen.getByRole('option', { name: /Tech Lead/ })).toBeInTheDocument()
  })

  test('clicking an agent inserts its id, which is what a mention is', async () => {
    const user = userEvent.setup()
    render(<Host />)
    const input = screen.getByRole('combobox', { name: 'Add a comment' })
    await user.type(input, 'ask @te')

    await user.click(screen.getByRole('option', { name: /Tech Lead/ }))

    expect(input).toHaveValue('ask @tech-lead ')
  })

  test('Enter picks the highlighted agent rather than posting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<Host onSubmit={onSubmit} />)
    const input = screen.getByRole('combobox', { name: 'Add a comment' })
    await user.type(input, '@te')

    await user.keyboard('{Enter}')

    expect(input).toHaveValue('@tech-lead ')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('the arrows move through the list', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), '@')

    await user.keyboard('{ArrowDown}{Enter}')

    expect(screen.getByRole('combobox', { name: 'Add a comment' })).toHaveValue('@debugging ')
  })

  test('Enter posts the comment when no list is open', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<Host onSubmit={onSubmit} />)

    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), 'just a note{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('Escape dismisses the list without posting', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<Host onSubmit={onSubmit} />)
    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), '@te')

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('does not offer the roster inside an email address', async () => {
    const user = userEvent.setup()
    render(<Host />)

    await user.type(screen.getByRole('combobox', { name: 'Add a comment' }), 'noel@te')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/renderer/MentionInput.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/MentionInput"`.

- [ ] **Step 3: Write the component**

Create `src/components/MentionInput.tsx`:

```tsx
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Agent, Status } from '@shared/types'
import { StatusDot } from './primitives'

interface MentionInputProps {
  value: string
  onChange: (value: string) => void
  /** Enter, when no agent list is open. */
  onSubmit: () => void
  agents: readonly Agent[]
  /** agentId -> the status its dot shows. */
  statuses: Record<string, Status>
  ariaLabel: string
  placeholder?: string
}

const LIST_ID = 'mention-suggestions'

/**
 * The mention being typed, if the caret sits inside one.
 *
 * Only the token immediately before the caret counts, so editing the middle
 * of a finished sentence does not reopen the list for a mention typed
 * earlier. The rules match `shared/mentions.ts`: an `@` that follows a word
 * character belongs to something else, such as an email address.
 *
 * Exported for its own tests — it is the whole of the interesting logic.
 */
export function activeMention(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const upto = text.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at === -1) return null

  const before = at === 0 ? '' : (upto[at - 1] ?? '')
  if (before !== '' && /[\w@]/.test(before)) return null

  const query = upto.slice(at + 1)
  // Anything else — a space, punctuation — ended the token.
  if (!/^[a-zA-Z0-9-]*$/.test(query)) return null

  return { query: query.toLowerCase(), start: at }
}

/**
 * A comment box that completes `@agent-id`.
 *
 * Built on the ARIA combobox pattern, like `AssigneeField`, rather than
 * extracted from it: that one is a field holding a value, this is a popover
 * over free text driven by caret position, and one component doing both
 * would serve neither.
 */
export function MentionInput({
  value,
  onChange,
  onSubmit,
  agents,
  statuses,
  ariaLabel,
  placeholder,
}: MentionInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const [pendingCaret, setPendingCaret] = useState<number | null>(null)

  // Moving the caret has to wait for the value React was handed to land.
  useEffect(() => {
    if (pendingCaret === null) return
    ref.current?.setSelectionRange(pendingCaret, pendingCaret)
    setCaret(pendingCaret)
    setPendingCaret(null)
  }, [pendingCaret])

  const token = dismissed ? null : activeMention(value, caret)
  const matches =
    token === null
      ? []
      : agents.filter(
          (agent) =>
            agent.id.includes(token.query) || agent.name.toLowerCase().includes(token.query),
        )
  const open = matches.length > 0
  const highlighted = matches[active] ?? matches[0]

  function pick(agent: Agent): void {
    if (token === null) return

    // The trailing space is what ends the token, so the list closes and the
    // next word is ordinary text.
    const next = `${value.slice(0, token.start)}@${agent.id} ${value.slice(caret)}`
    onChange(next)
    setDismissed(true)
    setActive(0)
    setPendingCaret(token.start + agent.id.length + 2)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    // The modal closes on Escape and posts on Enter elsewhere; while this
    // box has focus both keys belong to it.
    e.stopPropagation()

    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((current) => (current + step + matches.length) % matches.length)
        return
      }

      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (highlighted) pick(highlighted)
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }

    if (e.key === 'Enter') onSubmit()
  }

  return (
    <div className="relative flex-1">
      {open ? (
        <ul
          id={LIST_ID}
          role="listbox"
          aria-label="Agents"
          className="absolute right-0 bottom-full left-0 z-[5] m-0 mb-[3px] list-none overflow-hidden rounded-field border border-line-card bg-card p-0 shadow-[0_8px_20px_rgba(0,0,0,0.4)]"
        >
          {matches.map((agent, index) => (
            <li
              key={agent.id}
              id={`mention-${agent.id}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: the input blurs first and the list
              // would go out from under the click.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(agent)
              }}
              className={`flex cursor-pointer items-center gap-[7px] px-[9px] py-[6px] ${
                index === active ? 'bg-accent-surface-2' : ''
              }`}
              data-hoverable
            >
              <StatusDot status={statuses[agent.id] ?? 'idle'} />
              <span className="text-md text-ink">{agent.name}</span>
              <span className="ml-auto font-mono text-sm text-dim">@{agent.id}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={ref}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={LIST_ID}
        aria-autocomplete="list"
        {...(open && highlighted ? { 'aria-activedescendant': `mention-${highlighted.id}` } : {})}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
          setDismissed(false)
          setActive(0)
        }}
        onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        className="w-full rounded-chip border border-line-card bg-card px-[10px] py-[6px] font-ui text-md text-ink outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2"
      />
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/renderer/MentionInput.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/MentionInput.tsx tests/renderer/MentionInput.test.tsx
git commit -m "feat: complete agent mentions as they are typed"
```

---

### Task 8: The thread uses it, and renders Markdown

**Files:**
- Modify: `src/screens/TaskDetailBody.tsx` (`Thread`)
- Test: `tests/renderer/TaskDetailModal.test.tsx`

**Interfaces:**
- Consumes: `MentionInput` (Task 7), `Markdown` from `@/components/Markdown`, `agentStatus` from `@/state/store`.
- Produces: no new exports. The comment box is now a combobox named "Add a comment"; existing tests that target it by that label keep working.

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer/TaskDetailModal.test.tsx`:

```tsx
describe('TaskDetailModal — mentioning an agent in a comment', () => {
  test('completes an agent as it is typed', async () => {
    const user = userEvent.setup()
    render(<TaskDetailModal />)

    await user.type(await screen.findByRole('combobox', { name: 'Add a comment' }), 'ask @de')

    expect(screen.getByRole('option', { name: /Debugging Agent/ })).toBeInTheDocument()
  })

  test('posts the mention as written, so the main process can resolve it', async () => {
    const api = installRosterApi()
    const user = userEvent.setup()
    render(<TaskDetailModal />)
    const box = await screen.findByRole('combobox', { name: 'Add a comment' })

    await user.type(box, '@de')
    await user.click(screen.getByRole('option', { name: /Debugging Agent/ }))
    await user.type(box, 'what do you think?{Enter}')

    await waitFor(() =>
      expect(api.tasks.comment).toHaveBeenCalledWith(
        'ROS-101',
        '@debugging what do you think?',
      ),
    )
  })

  test('renders an answer as Markdown, since agents write it', async () => {
    installRosterApi({
      tasks: {
        comments: vi
          .fn()
          .mockResolvedValue([
            aTaskComment({ author: 'Debugging Agent', tone: 'agent', text: '## Findings' }),
          ]),
      },
    })
    render(<TaskDetailModal />)

    expect(await screen.findByRole('heading', { name: 'Findings' })).toBeInTheDocument()
    expect(screen.queryByText('## Findings')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/renderer/TaskDetailModal.test.tsx -t "mentioning an agent"`
Expected: FAIL — the comment box is a `textbox`, not a `combobox`, and comment text renders as source.

- [ ] **Step 3: Swap the composer and the renderer**

In `src/screens/TaskDetailBody.tsx`:

Add the import:

```tsx
import { MentionInput } from '@/components/MentionInput'
```

Change `Thread`'s props so it receives the roster the body already reads, rather than subscribing again:

```tsx
interface ThreadProps {
  taskId: string
  comments: readonly TaskComment[]
  agents: readonly Agent[]
  statuses: Record<string, Status>
}
```

Add `Agent` and `Status` to the `@shared/types` type import at the top of the file.

Pass them at the call site, replacing `<Thread taskId={task.id} comments={thread} />`:

```tsx
        <Thread taskId={task.id} comments={thread} agents={agents} statuses={statuses} />
```

In `Thread`, change the signature to `function Thread({ taskId, comments, agents, statuses }: ThreadProps)`.

Replace the comment body span with `Markdown`:

```tsx
              <Markdown>{comment.text}</Markdown>
```

Replace the whole composer `<input>` with the mention box, keeping the button:

```tsx
      {tab === 'comments' ? (
        <div className="flex items-center gap-[8px]">
          <MentionInput
            ariaLabel="Add a comment"
            placeholder="Add a comment, or @mention an agent"
            value={text}
            onChange={setText}
            onSubmit={() => void post()}
            agents={agents}
            statuses={statuses}
          />
          <button
            type="button"
            onClick={() => void post()}
            disabled={posting || text.trim() === ''}
            className="cursor-pointer rounded-chip border-0 bg-accent px-[12px] py-[6px] font-ui text-md font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            Comment
          </button>
        </div>
      ) : null}
```

- [ ] **Step 4: Run the task tests to verify they pass**

Run: `npx vitest run tests/renderer/TaskDetailModal.test.tsx tests/renderer/Backlog.test.tsx tests/renderer/Tasks.test.tsx`
Expected: PASS with no edits to the existing tests. The three that already touch the composer (`TaskDetailModal.test.tsx:282`, `:286`, `:299`) find it with `findByLabelText('Add a comment')` / `queryByLabelText`, which does not care about the role — and the `aria-label` is deliberately unchanged. `:286` asserts the box is absent on the History tab, so keep the composer inside the `tab === 'comments'` branch.

- [ ] **Step 5: Commit**

```bash
git add src/screens/TaskDetailBody.tsx tests/renderer/TaskDetailModal.test.tsx
git commit -m "feat: mention agents from the task comment box"
```

---

### Task 9: The rail lists attached sessions

**Files:**
- Modify: `src/screens/TaskDetailBody.tsx` (load the links; add a `Sessions` rail row)
- Test: `tests/renderer/TaskDetailModal.test.tsx`

**Interfaces:**
- Consumes: `taskSessions`, `setTaskSessions`, `NO_TASK_SESSIONS` (Task 6); `window.roster.tasks.sessions` (Task 5); `openAgent`, `closeTask` from the store.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `tests/renderer/TaskDetailModal.test.tsx`:

```tsx
describe('TaskDetailModal — the sessions a task has attached', () => {
  const LINK = {
    taskId: 'ROS-101',
    agentId: 'debugging',
    sessionId: 'session-9',
    createdAt: 1_700_000_000_000,
  }

  test('says nothing about sessions until there is one', async () => {
    render(<TaskDetailModal />)

    await screen.findByText('ROS-101')
    expect(screen.queryByRole('button', { name: /Open Debugging Agent/ })).not.toBeInTheDocument()
  })

  test('reads the attached sessions when the task opens', async () => {
    const api = installRosterApi()
    render(<TaskDetailModal />)

    await waitFor(() => expect(api.tasks.sessions).toHaveBeenCalledWith('ROS-101'))
  })

  test('lists the agent a mention put on the task', async () => {
    installRosterApi({ tasks: { sessions: vi.fn().mockResolvedValue([LINK]) } })
    render(<TaskDetailModal />)

    expect(
      await screen.findByRole('button', { name: 'Open Debugging Agent' }),
    ).toBeInTheDocument()
  })

  test('opens the session, and leaves the task behind', async () => {
    installRosterApi({ tasks: { sessions: vi.fn().mockResolvedValue([LINK]) } })
    const user = userEvent.setup()
    render(<TaskDetailModal />)

    await user.click(await screen.findByRole('button', { name: 'Open Debugging Agent' }))

    const state = useRoster.getState()
    expect(state.screen).toBe('agent')
    expect(state.agentId).toBe('debugging')
    expect(state.sess['debugging']).toBe('session-9')
    // Otherwise coming back to Tasks pops the modal open over the session
    // the user just went to read.
    expect(state.openTaskId).toBeNull()
  })

  test('shows a session an agent was mentioned into while the panel was open', async () => {
    installRosterApi()
    render(<TaskDetailModal />)
    await screen.findByText('ROS-101')

    useRoster.getState().applyTaskEvent({ type: 'task-session', taskId: 'ROS-101', link: LINK })

    expect(
      await screen.findByRole('button', { name: 'Open Debugging Agent' }),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/renderer/TaskDetailModal.test.tsx -t "attached"`
Expected: FAIL — `api.tasks.sessions` is never called and no such button exists.

- [ ] **Step 3: Load the links and render the rail row**

In `src/screens/TaskDetailBody.tsx`:

Extend the store imports:

```tsx
import {
  NO_COMMENTS,
  NO_TASK_SESSIONS,
  agentStatus,
  projectOptionLabel,
  projectPickerProjects,
  reduceTaskEvent,
  useRoster,
  type TaskTab,
} from '@/state/store'
```

Add `StatusDot` to the `@/components/primitives` import.

Inside `TaskDetailBody`, beside the other selectors:

```tsx
  const setTaskSessions = useRoster((s) => s.setTaskSessions)
  const openAgent = useRoster((s) => s.openAgent)
  const closeTask = useRoster((s) => s.closeTask)
  const attached = useRoster(useShallow((s) => s.taskSessions[task.id] ?? NO_TASK_SESSIONS))
```

Extend the existing thread effect so both reads happen when the task opens — replace its body with:

```tsx
  useEffect(() => {
    let cancelled = false

    void window.roster.tasks
      .comments(taskId)
      .then((loaded) => {
        if (!cancelled) setTaskComments(taskId, loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageFor(cause))
      })

    void window.roster.tasks
      .sessions(taskId)
      .then((loaded) => {
        if (!cancelled) setTaskSessions(taskId, loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageFor(cause))
      })

    return () => {
      cancelled = true
    }
  }, [taskId, setTaskComments, setTaskSessions])
```

Add the rail row between the `Labels` rail and the `Delete` block:

```tsx
        {/* Only once a mention has put a session here — an untouched task's
            rail should read exactly as it did before. */}
        {attached.length > 0 ? (
          <Rail label="Sessions">
            <div className="flex flex-col gap-[2px]">
              {attached.map((link) => {
                const agent = agents.find((candidate) => candidate.id === link.agentId)
                const name = agent?.name ?? link.agentId

                return (
                  <button
                    key={link.sessionId}
                    type="button"
                    aria-label={`Open ${name}`}
                    onClick={() => {
                      // Leaving it open would pop the modal back over the
                      // session the moment the user returned to Tasks.
                      closeTask()
                      openAgent(link.agentId, link.sessionId)
                    }}
                    className="flex cursor-pointer items-center gap-[7px] rounded-chip border-0 bg-transparent px-[6px] py-[4px] text-left hover:bg-accent-surface-2"
                    data-hoverable
                  >
                    <StatusDot status={statuses[link.agentId] ?? 'idle'} />
                    <span className="truncate text-md text-ink-2">{name}</span>
                  </button>
                )
              })}
            </div>
          </Rail>
        ) : null}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/renderer/TaskDetailModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite, typecheck and coverage**

Run: `npm run check`
Expected: PASS — typecheck clean on both tsconfigs, coverage above every threshold, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/screens/TaskDetailBody.tsx tests/renderer/TaskDetailModal.test.tsx
git commit -m "feat: list a task's attached sessions in its rail"
```

---

### Task 10: Verify it end to end, and open the PR

**Files:**
- Modify: `TODO.md` (tick the line, if one is added for this)
- No source changes expected. If the manual run finds a defect, fix it with a test first, in the file that owns the behaviour.

**Interfaces:**
- Consumes: everything.
- Produces: a pull request.

- [ ] **Step 1: Run the full check one more time**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 2: Start the app against a scratch roster**

```bash
ROSTER_HOME=/tmp/roster-mentions npm run dev
```

A scratch home, not `~/roster`: this feature starts real turns that cost real money, and the seeded roster there is enough to exercise it.

- [ ] **Step 3: Walk the feature**

- [ ] Open a task; the rail has no `SESSIONS` row.
- [ ] Type `@` in the comment box; the roster appears above it with status dots and `@id` on the right.
- [ ] Type `@lea`; the list narrows by name as well as by id.
- [ ] Press Enter; the id is inserted with a trailing space and the list closes.
- [ ] Finish the sentence and press Enter; the comment posts **immediately**, without waiting for the agent.
- [ ] The `SESSIONS` row appears with the agent and a running dot.
- [ ] The answer arrives in the thread as an agent comment, rendered as Markdown.
- [ ] Comment again mentioning the same agent; no second session appears, and the agent's reply shows it remembers the first exchange.
- [ ] Mention a second agent; a second session appears, and the first agent is not asked again.
- [ ] Click a session in the rail; it opens the transcript, which starts with the brief. Return to Tasks; the modal does **not** re-open.
- [ ] Mention an agent whose runner is not installed; the failure lands in the thread rather than nowhere.
- [ ] Type `noel@tech-lead` in a comment; no list appears and no turn starts.
- [ ] Delete a task that has sessions; check the agent's session list still holds its transcript.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin worktree-feat+agent-mentions
gh pr create --fill
```

The PR body should cover `git diff main...HEAD`, and carry a test plan whose unchecked boxes are exactly the manual steps above that could not be automated.

- [ ] **Step 5: Leave the worktree**

Use `ExitWorktree` with `action: "keep"` until the PR merges.

---

## Self-Review

**Spec coverage.** §4 grammar → Task 1. §5 attachment → Task 2. §6 coordinator → Task 3. §7 reply → Task 4. §8 IPC → Task 5. §9 (only your comments dispatch) → Task 5, which calls `dispatch` from the `tasksComment` handler and nowhere else; `taskTools.comment` is deliberately left untouched. §10.1 composer → Task 7. §10.2 Markdown → Task 8. §10.3 rail → Task 9. §10.4 store → Task 6. §11 edge cases → Tasks 1 (email, unknown id), 2 (delete detaches), 4 (missing runner, already running), 10 (walked by hand). §12 test plan → distributed across the tasks it belongs to.

**Two known deviations from the spec, both deliberate:**

1. The spec's §6 said a new session sends the bare comment and only a resumed one is prefixed with the task key. The plan prefixes **both**, which removes a branch for no loss — the brief on a new session already names the task, so the prefix is merely consistent.
2. The spec's §11 note about amending the delete-confirmation copy is **not** a task here. That copy lives in PR #32, which has not merged; changing it from this branch would collide. It belongs in a follow-up once #32 lands.

**Placeholder scan.** No TBDs, no "add error handling", no "similar to Task N". Every code step carries the code.

**Type consistency.** `TaskSessionLink` has the same four fields in `shared/types.ts` (Task 2), the store test (Task 6), and the rail (Task 9). `findByTask(taskId, agentId)` and `linksForTask(taskId)` are named identically in Tasks 2, 3 and 5. `MentionRunner.send(sessionId, prompt)` is structurally satisfied by `SessionManager.send(sessionId, prompt, options?)`, which is what lets Task 5 pass `manager` directly. `parseMentions(text, knownAgentIds)` has the same signature in Tasks 1 and 3. `NO_TASK_SESSIONS` is defined in Task 6 and consumed in Task 9.

**One thing an implementer should watch:** Task 8 changes the comment box's role from `textbox` to `combobox`. Checked against the suite as it stands, this breaks nothing — the three existing tests that touch the composer use `findByLabelText` / `queryByLabelText`, which is role-agnostic, and the `aria-label` is deliberately unchanged. If a test is added between now and then that finds it with `getByRole('textbox', …)`, that is the one line to change.
