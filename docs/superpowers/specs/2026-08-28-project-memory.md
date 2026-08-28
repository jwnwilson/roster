# Project memory across sessions

A plan, not an implementation. Written 2026-08-28, against the code on
`feat/tasks-kanban`.

## 1. The problem, precisely

An agent starts every turn from nothing but its `agent.toml` system prompt.
Within one session it keeps context — `SessionManager.send` passes
`session.runnerSessionId` as `resumeFrom`, so the CLI resumes its own thread.
Across sessions there is nothing.

Two things follow, and they are different problems:

1. **The same agent re-derives what it already worked out.** Ask the Debugging
   Agent about the pool leak in a new session and it re-reads the same files,
   re-forms the same hypothesis, and re-learns that `release()` is the one that
   double-frees.
2. **A different agent cannot know it at all.** The Review Agent has no way to
   reach what the Debugging Agent concluded an hour ago, even when both
   sessions are filed under the same project.

The second is the expensive one, and it is the one a *project* is positioned to
fix: a project is already the thing that says "these pieces of work belong
together". `Session.projectId` exists and is assigned by hand from the config
rail (spec §13.21 — nothing infers it, because nothing can).

## 2. What already exists that we should not rebuild

Worth being blunt about, because a memory feature is easy to over-build:

- **The board is already durable per-project shared state.** Tasks carry a
  Markdown description, a comment thread, and a History log; every entry is
  attributed and timestamped. `TaskStore.apply` is the single writer, and it
  emits, so a change an agent makes reaches the board live.
- **Agents can already read and write it.** The built-in `tasks` MCP server
  exposes `list_tasks`, `read_task`, `update_task`, `comment_on_task` and
  `create_task`, and is enabled per agent from the MCP screen (§13.30).
- **Files on disk are the app's idiom for anything a person should be able to
  read.** `agent.toml`, `~/roster/skills/*/SKILL.md` and `mcp.json` are all
  plain files, watched for external edits. SQLite holds runtime state —
  sessions, messages, usage, the board.
- **Skills are already the mechanism for "here is standing knowledge, injected
  as context"** — folders of Markdown handed to the runner as
  `additionalDirectories`, enabled per agent.

So the gap is narrower than "agents need memory". It is:

- knowledge that is not a task and does not belong to one, and
- **injection**: even today, an agent must be *told* to go and look at the
  board. Nothing puts the project in front of it.

## 3. Options considered

**A. Inject the project's existing state into each turn.** No new storage.
Build a short brief from `ProjectStore.findById` and `TaskStore` and prepend it
to the prompt when `session.projectId` is set.

- For: nothing to migrate, nothing to keep in sync, and it makes the board
  worth writing to — an agent's comment becomes something the next agent reads.
- Against: only covers what fits the shape of a task.

**B. A notes file per project.** `~/roster/projects/<slug>/NOTES.md`, watched
like `agent.toml`, edited in-app and appended by agents through a `memory` MCP
server.

- For: matches the app's idiom exactly — inspectable, hand-editable, diffable,
  and gated per agent by the control that already exists.
- Against: gives projects a folder, which they do not currently have; needs the
  same second-writer handling `TaskStore` already has.

**C. A memory table in SQLite with `remember`/`recall` tools.** Structured rows
keyed by project.

- For: queryable, no file watching.
- Against: opaque. The user cannot read it, correct it, or delete one wrong
  line, and a memory the user cannot audit is one they cannot trust. Roster's
  whole posture is that its state is files you own.

**D. Retrieval over past transcripts** — embed messages, retrieve by
similarity.

- For: catches things nobody thought to write down.
- Against: an embedding model, a vector store, and a network or local-model
  dependency in an app that otherwise runs offline behind a strict CSP. It also
  retrieves *what was said*, which is mostly noise; what is wanted is *what was
  concluded*.

**E. Fork the project's last session** — resume its `runnerSessionId` with
`forkSession`, which the handoff path already does.

- For: nearly free; the plumbing exists.
- Against: it inherits everything, noise included, and the config rail already
  shows sessions at 60% of context window. It also only works for one lineage,
  so it does not solve the cross-agent half at all.

## 4. Recommendation

**A first, then B.** C and D are rejected outright; E is rejected as a memory
mechanism, though the fork primitive stays where it is for handoff.

### Phase 1 — inject the project (no new storage)

A new `electron/main/sessions/projectBrief.ts` builds a compact block:

```
Project: API reliability
Retries and pool exhaustion under load.

Open tasks
- ROS-6 [in_progress] high — Fix connection pool leak on 504 (Debugging Agent)
- ROS-8 [in_review] medium — ADR-014: multi-region session store (Architect Agent)

Recent notes from other agents
- Debugging Agent on ROS-6: release() double-frees when the 504 handler retries.
```

`SessionManager.send` prepends it when `session.projectId !== null`. It is
built from stores that are already in the manager's constructor, so nothing new
is wired in.

Rules that matter:

- **Capped, and honest about the cap.** A hard budget (start at ~2000
  characters), open tasks before done ones, newest comments first, and a
  trailing `(+N more tasks — use list_tasks)` line when it truncates. Silent
  truncation would read as "that is the whole project".
- **Not persisted as a message.** It is prompt context, not transcript; writing
  it into `messages` would put a wall of generated text in the user's chat
  every turn.
- **Only when filed.** A session with no project gets nothing, unchanged.

Verifiable end to end: file two sessions on different agents under one project,
have the first comment on a task, and check the second knows it without being
told to look.

### Phase 2 — a notes file per project

For what is not a task: decisions, conventions, gotchas, "we tried X and it
did not work".

- `~/roster/projects/<slug>/NOTES.md`, created on demand. Projects keep their
  SQLite row as the source of identity; the folder is only for files.
- A `ProjectNotesStore` with the same shape as `SkillStore` — load, watch,
  read, write — so external edits show up like an edited `agent.toml` does.
- Edited in-app by reusing the Skills editor component rather than growing a
  second one.
- A built-in `memory` MCP server, listed and enabled per agent exactly like
  `tasks` (§13.30), with two tools:
  - `recall()` — the notes for this session's project.
  - `remember(note)` — appends one dated, attributed line.
- Phase 1's brief gains the notes at the top, under the same budget.

`remember` appends rather than rewrites, deliberately: an agent that can
rewrite the file can delete what another agent or the user wrote, and an
append-only log is the version of this that cannot lose work. Compaction, if it
is ever needed, is Phase 3 and should be something the user triggers and sees.

### Phase 3 — only if Phase 2 proves it necessary

Compaction of long notes, and search across past transcripts. Both are real
work; neither should be started before there is a project whose notes have
actually outgrown the budget.

## 5. Risks

- **Prompt bloat.** Every turn pays for the brief. The budget is the control,
  and the context-window bar in the config rail is where it will show up first.
- **Two writers.** The user editing `NOTES.md` while an agent appends to it is
  the problem `TaskStore` already solved with `subscribe`/`emit`; the notes
  store needs the same, plus append rather than write-whole-file.
- **Stale memory read as fact.** A note from three weeks ago is asserted with
  the same confidence as one from this morning. Dating every line and putting
  the newest first is the cheap mitigation; nothing else is cheap.
- **Everything in the brief goes to the model every turn.** A project's notes
  are as sensitive as its tasks. Worth stating in the UI when the notes editor
  lands, and worth keeping `memory` per-agent-gated for the same reason `tasks`
  is.
- **Slug collisions and renames.** Two projects called "API reliability" want
  the same folder, and renaming a project must not orphan its notes. Key the
  folder on the project's id, not its name, and show the name in the UI only.

## 6. What this plan does not do

It does not give agents memory *outside* a project. That is deliberate — an
unscoped memory has no natural boundary, no natural owner, and no natural place
to be read or corrected. A project is all three.
