# Mentioning an agent in a task comment

A plan, not an implementation. Written 2026-08-31, against `origin/main` at
`d21f40e` (v0.1.7).

## 1. What this adds

Writing `@tech-lead what do you make of this?` in a task's comment thread
sends that question to the Tech Lead agent, opens a session for it attached to
the task, and posts its answer back into the same thread.

Mention the same agent again and the question continues the session it already
has, so it still remembers what you asked it about this task an hour ago.
Mention a different agent and that one gets its own session on the same task.

The thread becomes the place the question is asked, the place the answer
appears, and the record of both.

## 2. What already exists that we should not rebuild

Being blunt about this, because most of the mechanism is already here:

- **`SessionManager.handOff()` is nearly this feature.** It creates a session
  on another agent, records a `spawn` message carrying a brief that opens the
  transcript, and links the two sides. A mention is that same move with a task
  as the origin rather than a session.
- **`TaskStore` already publishes.** It has two writers — the person at the
  keyboard and any agent holding the task tools — so it emits, and the IPC
  layer already broadcasts `CHANNELS.tasksEvent` to every window. A comment
  arriving from a background turn reaches the open modal with no new plumbing.
- **`reduceTaskEvent` is idempotent by design**, so a locally-applied change
  and the broadcast that follows it do not fight.
- **Sessions already carry `project_id`**, assigned by hand from the config
  rail. "Which work is this session about" is an established column on that
  table, not a new idea.
- **`Markdown` already says it is for comments.** Its docblock reads *"Task
  descriptions and comments, rendered"* — the thread simply never used it and
  renders comment text in a bare `<span>`.

What does not exist: any link from a task to a session, any notion of a
mention, and any way for a person to start an agent's turn from outside the
chat pane.

## 3. Decisions taken up front

These were settled before the design, and the rest of it follows from them.

**The answer is posted automatically.** When the mentioned agent's turn ends,
Roster writes its prose into the thread as an agent comment. The alternative —
telling the agent to call `comment_on_task` itself — only works for agents
that have enabled the `tasks` server in their `mcp_servers`, and mentioning
any other agent would produce silence. An `@mention` must always visibly
produce an answer where the question was asked, for every agent.

**One session per agent, per task.** A `Session` row belongs to exactly one
agent, so "the session attached to the task" can only be singular if a task is
restricted to one agent. It is not: asking two agents for a second opinion is
the point. The natural key is `(task_id, agent_id)`.

**Full task on first contact, then just the comment.** The opening brief
carries the whole task; later mentions resume the session and send only what
you wrote. Re-sending the description on every exchange would be paid for on
every turn to fix a staleness problem that rarely bites.

**A mention is a question, not a handover.** Mentioning does not assign the
task, does not move it, and writes no History. In this codebase assignment is
not inert — `TaskStore.resolve` flips a `todo` task to `in_progress` and logs
*"X picked up this task."* Asking three agents for an opinion must not drag the
card across the board three times. An agent that decides to take the work can
still assign itself through `update_task`.

**Only comments you write dispatch mentions.** See §9.

## 4. The mention grammar — `shared/mentions.ts`

```ts
export interface Mention {
  agentId: string
  /** Offsets into the source text, so the composer can replace the token. */
  start: number
  end: number
}

export function parseMentions(
  text: string,
  knownAgentIds: readonly string[],
): Mention[]
```

The token is an **agent id**, not a name. Ids are slugs — `AgentStore.slugify`
lowercases and collapses everything non-alphanumeric to hyphens, giving
`tech-lead`, `debugging-agent` — so `@tech-lead` is one unambiguous word.
Names are not: `@Tech Lead` would need greedy multi-word matching against the
roster, and would break the moment two agents shared a first word. It is also
how every other agent reference in the app is already addressed — `assignee`
on a task, `agent_id` on `open_session`.

Matching rules:

- `@` followed by `[a-z0-9][a-z0-9-]*`, compared case-insensitively, so
  `@Tech-Lead` resolves.
- The `@` must be at the start of the text or follow a non-word character.
  This is what stops `noel@tech-lead` in prose from being read as a mention.
- The captured token is looked up in `knownAgentIds`. **An unknown `@foo` is
  ordinary text, never an error** — people write `@here` and `@me` without
  meaning anything by it.
- Results are deduplicated, in first-mention order, so `@tech-lead ... again
  @tech-lead` dispatches once.

One deliberate limitation: `@tech-lead-agent`, when only `tech-lead` exists,
matches nothing rather than falling back to the longest known prefix. The
composer inserts correct ids, and a silent partial match would send the
question somewhere the author did not name.

The module is shared because the renderer highlights and completes mentions
while the main process resolves them, and those two must agree on what counts
as one.

## 5. Where the attachment lives

```sql
ALTER TABLE sessions ADD COLUMN task_id TEXT REFERENCES tasks (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX ux_sessions_task_agent
  ON sessions (task_id, agent_id) WHERE task_id IS NOT NULL;
```

Appended to `MIGRATIONS` in the usual way; `user_version` carries it. A plain
`ADD COLUMN`, like migrations 6 and the `archived_at` one — nothing to widen,
so none of migration 5's table rebuild. SQLite permits a `REFERENCES` clause
on `ADD COLUMN` exactly when the default is NULL, which it is. `foreign_keys`
is already `ON` in `openDb`.

**A column on `sessions`, not a join table.** The table already carries
`project_id` for the same kind of fact, and a column answers *find the session
for (task, agent)* with one indexed lookup and no join. A `task_sessions`
table would add a file, a store and a cascade for a strictly one-to-one fact.

**The partial unique index is the real invariant.** One session per agent per
task is enforced by the database rather than remembered by the coordinator, so
a race between two dispatches cannot produce two sessions for one pair.

**`ON DELETE SET NULL`, not cascade.** Deleting a task must not destroy a
transcript. Those sessions cost real money, their rows feed `UsageStore` and
the Spend screen, and losing spend history to a board tidy-up would be wrong.
The task goes; the conversation survives, unattached.

On the wire, `Session` gains `taskId?: string | null`. That is also what lets
the session pane render a pill back to `ROS-12` without a second query.

## 6. The coordinator — `electron/main/sessions/mentions.ts`

A `TaskMentions` class, constructed with the agent store, the session store,
the session manager and the task store, and called by the `tasks:comment`
handler once the comment has been written.

For each mentioned agent:

1. `sessions.findByTask(taskId, agentId)`.
2. **No session** — create one titled `ROS-12 — Fix the auth flow`, with
   `task_id` set, and record a `spawn` message whose text is the brief: key,
   title, status, priority, description, and the thread so far. This mirrors
   what `handOff` records, and for the same reason: a transcript should open
   by saying why it exists.
3. **Session exists** — resume it, and send only the new comment, opening with
   the task key (`On ROS-12: …`) so the agent knows which task the question is
   about without re-reading the brief.
4. `manager.send(sessionId, prompt)`.

`CreateSessionInput` gains `taskId?: string`. The `spawn` message takes
`from: 'You'` — the field is required on `SpawnMessage`, and by §9 the author
is always a person. Its optional `to` is **omitted**: `SessionRef` points at
an agent and a session, and this session's origin is a task. The link back is
rendered from `session.taskId`, which is why that column carries onto the wire
in §5.

The handler **does not await step 4.** `send()` runs the entire turn; awaiting
it would mean posting a comment blocked until the agent finished. `dispatch()`
returns a promise that the IPC handler discards with `void` and tests can
await — that seam is what keeps fire-and-forget testable.

The session's `origin` is always `'you'`, since by §9 only a person's comment
dispatches. If agent-authored mentions ever land, that is the field that would
carry the distinction, along with `from`.

## 7. Getting the answer back

Before dispatching, take a watermark: the count of messages already in that
session. When `send()` settles, read the session's messages, keep the ones
after the watermark that are `kind: 'text'` with `role: 'assistant'`, join
their text with a blank line, and write that as a task comment with
`tone: 'agent'` and the agent's name as author.

Joining rather than taking the last one matters: `SessionManager` buffers
streamed prose and flushes it in chunks (`pendingText` / `flushText`), so one
turn is routinely several text messages. Taking only the final one would post
the last paragraph of an answer and drop the rest.

Three outcomes, all of which end in a comment:

- **Prose produced** — post it.
- **The turn threw** — post `Couldn't answer — <reason>.` An asynchronous
  failure can no longer reject the IPC call, so the thread is the only place
  it can surface. The one error worth rewording is
  `this session is already running`, which becomes *"…is still working on your
  last question."*
- **No prose at all** (the agent only ran tools) — post one line naming the
  attached session, so a mention never silently produces nothing.

## 8. IPC surface

```ts
tasks: {
  // ...
  /** Sessions attached to this task — one per agent mentioned on it. */
  sessions(taskId: string): Promise<TaskSessionLink[]>
}
```

- New channel `tasksSessions: 'tasks:sessions'`.
- `TaskEventPayload` gains `{ type: 'task-session'; taskId: string; link: TaskSessionLink }`.
- New shared type `TaskSessionLink { taskId, agentId, sessionId, createdAt }`.
  Agent name and status are derived in the renderer from `s.agents`, which it
  already holds, so the link stays minimal.
- `Session` gains `taskId`.
- `tasks.comment` keeps its signature. The mention is resolved behind it.
- `tests/renderer/rosterApi.ts` gains `sessions: vi.fn().mockResolvedValue([])`.

The new event is **payload-only** — it is not added to `TaskStore`'s own
`TaskEvent` union, because a session link is not a change to a task. There is
precedent: `projects` is already in `TaskEventPayload` and not in `TaskEvent`.
The coordinator broadcasts it through an `onAttached` callback that the IPC
setup wires to `broadcast(CHANNELS.tasksEvent, …)`.

## 9. Why only your own comments dispatch

Routing the agents' own `comment_on_task` through the coordinator would give
agent-to-agent consultation for nothing, and would also give an unbounded
loop: A's auto-posted answer mentions B, B's answer mentions A, forever.

So in this version a mention dispatches **only from a comment written by a
person** — via the `tasks:comment` handler. Comments written by agents, the
auto-posted answers included, are inert text. This is a real limitation and it
is chosen: the coordinator remains the right seam for agent-to-agent mentions
later, but a chain or depth guard is not worth designing before there is a
case to shape it.

## 10. The renderer

### 10.1 `src/components/MentionInput.tsx`

Replaces the plain comment `<input>` in `Thread`. It finds the active mention
token — the last `@…` before the caret — and offers matching agents; picking
one replaces the token with `@id `.

Built on the same ARIA combobox pattern as `AssigneeField` (arrows move,
Enter picks, Escape closes, `aria-activedescendant` tracks the highlighted
option), but a separate component rather than an extraction: `AssigneeField`
is a field that holds one value, this is a popover over free text driven by
caret position, and forcing them together would serve neither.

Agents match on **id or name**, so `@lead` finds `tech-lead`. Options show a
`StatusDot`, the name, and the id in dim mono — the id is what gets inserted,
so it has to be visible.

Two interaction details that need care:

- **Enter is overloaded.** With the popover open it picks the highlighted
  agent. Closed, it posts the comment, exactly as today.
- **Escape must `stopPropagation`.** Otherwise it closes the whole modal and
  throws the draft away — the same trap `Title` already documents.

Hidden agents remain mentionable. Hiding is a view control and the codebase is
explicit that a hidden agent is still assignable and still a handoff target.

### 10.2 The thread

Comment text renders through `<Markdown>` instead of a bare `<span>`.
Auto-posted answers are markdown, and the component was written for this.

Mentions are **not** highlighted in rendered comments in this version.
Reaching text nodes inside `react-markdown` needs a remark plugin, and plain
`@tech-lead` reads perfectly well. The affordance that earns its cost is the
composer's autocomplete.

### 10.3 The rail

A `Sessions` row between `Labels` and `Delete`: one line per attached session
with a `StatusDot` and the agent's name, opening it via
`openAgent(agentId, sessionId)`. The row is absent when nothing is attached,
so an untouched task's rail is unchanged.

Opening one also clears `openTaskId` — otherwise navigating back to Tasks
would pop the modal open again over the session the user just went to read.

### 10.4 Store

`taskSessions: Record<string, TaskSessionLink[]>`, loaded in the same effect
that loads the thread, with `setTaskSessions` beside `setTaskComments`.
`reduceTaskEvent` gains a `task-session` case (append, idempotent by session
id, matching how the rest of that reducer behaves) and clears the entry on
`task-deleted`.

## 11. Edge cases

- **The agent's runner is missing.** Its `status` is `error`. The session
  opens, `send` fails, and the failure comment names the reason. One path, no
  special case.
- **Mentioned while mid-turn.** `send` throws `this session is already
  running`, reworded per §7. No queueing.
- **The same agent mentioned twice in one comment.** Deduplicated by the
  parser; one dispatch.
- **A comment with no mentions.** Nothing is dispatched — the existing
  behaviour, unchanged.
- **Deleting a task.** Its sessions survive with `task_id` NULL. If PR #32
  (delete a task from its detail panel) has landed by the time this is built,
  its confirmation copy — *"Its comments and history go with it."* — should
  gain a clause saying sessions are kept.

## 12. Test plan

Written failing first, in this order.

**`tests/main/mentions.test.ts`** — finds a mention and returns its offsets;
ignores an id nobody has; ignores `noel@tech-lead`; matches case-insensitively;
deduplicates a repeated mention; returns nothing for text with no `@`.

**`tests/main/taskMentions.test.ts`** — against a fake `SessionManager` and
real stores on an in-memory database: opens a session on first mention with
the task in its brief; reuses that session on the second mention and sends
only the comment; opens separate sessions for two different agents; posts the
assistant prose as an agent comment; posts a failure comment when the turn
throws; rewords the already-running error; posts the fallback line when a turn
produced no prose; dispatches nothing for a comment with no mentions;
dispatches nothing for an agent-authored comment.

**`tests/main/sessions.test.ts`** — `findByTask` returns the attached session;
the unique index refuses a second session for the same `(task, agent)`;
deleting a task nulls `task_id` and leaves the session and its messages.

**`tests/renderer/MentionInput.test.tsx`** — the popover opens on `@`; filters
by id and by name; Enter picks and inserts the id; Escape closes without
posting or closing the modal; Enter with the popover closed posts the comment.

**`tests/renderer/TaskDetailModal.test.tsx`** — the rail lists attached
sessions; clicking one navigates to it; the row is absent when there are none.

**`tests/renderer/store.test.ts`** — `task-session` appends and applying it
twice changes nothing; `task-deleted` clears the entry.

`electron/main/ipc/index.ts` is excluded from coverage, so the handler wiring
is verified by hand; everything else lands inside the thresholds (80%
statements/lines/functions, 70% branches).

## 13. Verification

```bash
npx vitest run -t "mention"
npm test
npm run typecheck
npm run check
```

Manual, against a scratch roster so no real board is touched:

```bash
ROSTER_HOME=/tmp/roster-mentions npm run dev
```

1. Open a task, comment `@<id> what do you make of this?`
2. The `Sessions` row appears in the rail with a running dot.
3. The answer arrives in the thread as an agent comment, rendered as markdown.
4. Comment again; confirm the same session is reused and the agent still has
   the earlier exchange.
5. Mention a second agent; confirm a second session, not a second turn on the
   first.
6. Click through to a session; confirm the transcript opens with the brief and
   that returning to Tasks does not re-open the modal.
7. Mention an agent whose runner is not installed; confirm the failure lands
   in the thread rather than nowhere.
