# Roster — Design Spec

**Date:** 2026-08-01
**Status:** Approved

---

## 1. Overview

Roster is a **single-user, local-only agent manager** with a Linear-style project
management UI. The operator sets up multiple agents on their own machine and coordinates
them through a **lead agent**, driving work from a board of projects → epics → features →
tasks.

A **project is any body of work the operator wants agents to carry out** — a code repository,
a research effort, a set of documents, a recurring ops chore. Roster is not a git tool that
happens to have a UI: a project declares its source as a git repository, a plain local folder,
or no code at all, and every project keeps its memory and its output in a `.roster/` folder of
its own (§4).

The defining constraint is that **roster is not a distributed service**. It runs as local
processes on one machine, for one person. There is no tenancy, no authentication, no
network deployment, no message broker, and no container orchestration. The UI is a plain
SPA talking to `localhost`, which keeps an Electron desktop wrapper available later without
rework.

- UI design source of truth: [`docs/design/README.md`](../design/README.md) plus the hi-fi
  and wireframe canvases in the same folder. The hi-fi canvas is the visual authority;
  the wireframes show structural intent only.

### Success criteria for the setup work described here

`make dev` boots the API against SQLite (migrated and seeded) and the UI; the UI renders
against MSW mocks with no backend; the backend serves health plus projects and work-items;
the agent-folder reader, the project-memory store, and a fake runtime are in place; CI is
green; and `docs/architecture.md` and ADR-0001 are written (`AGENTS.md` and
`docs/project-history.md` already exist and are kept current).

---

## 2. Repository structure

```
roster/
  AGENTS.md                 # stack, conventions, .roster contract, workflow
  Makefile                  # install dev run test coverage lint db-upgrade
  pyproject.toml            # uv workspace, single member: projects/server
  .env.example  .gitignore
  .github/workflows/ci.yml
  docs/
    project-history.md      # what ships, what is designed-only, what is next — read first
    design/                 # UI handoff bundle
    architecture.md         # layering rules new code must follow
    adr/0001-local-single-process.md
    specs/2026-08-01-roster-design.md
    superpowers/{specs,plans}/
  projects/
    server/
      pyproject.toml        # roster-server
      alembic.ini
      src/
        domain/             # rosters rules and entities — no I/O; may import adapter PORTS only
        adapters/           # project-agnostic infrastructure + the ports it implements
          storage/          #   FileStore protocol, local + in-memory implementations
          db/               #   SQLAlchemy models, repositories, UnitOfWork, migrations
          agents/           #   AgentRuntime (FakeRuntime, SubprocessRuntime later)
        interactors/        # entry points and orchestration
          api/              #   app factory, routers, deps, SSE
          cli/              #   seed
          turns/            #   AgentTurnManager
        config/             # settings — neutral, importable by every layer
      tests/
    ui/                     # React + Vite + Tailwind SPA
```

`libs/` is not created. The uv workspace has a single member; keeping the workspace form
means a library can be extracted later without restructuring the repo.

---

## 3. Backend architecture

**Light hexagonal, one package.** Three layers, with domain logic never touching I/O, and no
port/adapter ceremony beyond what that separation needs.

### Stack

- Python ≥ 3.12, package manager `uv`
- FastAPI + uvicorn, Pydantic v2, pydantic-settings with env prefix `roster_`
- SQLAlchemy 2.0 **async only**, SQLite via `aiosqlite`, WAL journal mode
- Alembic for migrations
- pytest + pytest-asyncio + httpx, 80% coverage gate; ruff + mypy

### Layers

**`domain/`** — roster rules and entities: status transitions, work-item hierarchy, agent-folder
parsing, memory compaction, project-folder resolution. No argparse and no I/O of its own. It may
import **port protocols** from `adapters/` and receives an implementation by injection; it never
imports a concrete adapter, `interactors/`, or `config/` — configuration arrives as plain values. Each entity model is
co-located in the domain module that owns it; there is no central `models.py`. Entities are
updated via `model_copy(update={...})` and never mutated.

**`adapters/db/`** — SQLAlchemy declarative models, an async session factory, and a
**Repository + UnitOfWork** layer. A generic `AsyncSqlRepository[DTO]` base provides
create/read/read_multi/update/delete against an ORM model and a Pydantic DTO; one thin subclass
per entity binds the two. An `AsyncUnitOfWork` owns a single session and transaction boundary and
exposes the repositories as properties, so a request or an agent turn is one atomic scope. Interactors
depend on the `UnitOfWork` protocol rather than on `AsyncSession` directly.

**`adapters/agents/`** — the `AgentRuntime` protocol and its implementations: `SubprocessRuntime`
(real) and `FakeRuntime` (tests and the default `make dev`). Folder *parsing* is a roster rule and
lives in `domain/agents.py`.

**`adapters/storage/`** — the `FileStore` protocol and its implementations: a local filesystem
store and an in-memory store for tests. **Every store is rooted**: a path resolving outside the
root raises `FileNotFoundError`, so containment is a property of the store applied to every
operation, not a check each caller repeats. All of §5 memory logic — journal, digest, snapshots,
compaction — lives in `domain/memory.py` and reaches disk only through this port.

**`interactors/`** — entry points and orchestration: the FastAPI app factory, one hand-written
router per resource, the session dependency, SSE endpoints, the seed CLI, and the
`AgentTurnManager`. This is the only layer that may import from everywhere; it constructs concrete
adapters and drives domain logic with them.

**`config/`** — `Settings` (env prefix `roster_`) and the data-root path helpers. Deliberately its
own module rather than part of `api/`: adapters and the turn manager need settings too, and an
adapter importing from the API layer inverts the layering. Domain code takes plain values, never
the `Settings` object.

There is no `scripts/` folder.

**Which layer does something belong in?** Ask whether it would still make sense in a different
product. If yes, it is an adapter. If it encodes how *roster* works, it is domain. If it is how the
outside world gets in, it is an interactor. An adapter containing a roster rule — "a malformed
config disables the agent" — is misplaced, and so is domain code that opens a file.

### Why async-only

SSE endpoints hold a connection open for the lifetime of an agent turn. A synchronous database
session on that path blocks the event loop and stalls every other request, and a codebase
that offers both sync and async sessions will eventually take the wrong one on a streaming
route. Roster uses one engine and one session style from the first commit, so that mistake
is not available.

### Data root

Runtime data lives under a configurable root, defaulting to `~/.roster/`:

```
~/.roster/
  roster.db          # SQLite
  agents/            # one folder per agent
    atlas/
      AGENT.md       # instructions
      skills/        # one folder per skill
      config.yaml    # model, token limit, temperature
  projects/          # managed project folders — only for source.kind = "none" projects
    <project_id>/
      .roster/       # memory + artifacts, exactly as in any other project folder — §4
```

Projects with a `git` or `local` source keep everything inside their own folder; the data root
holds only the database, the agent folders, and managed project folders for source-less work.

Keeping data out of the repo means the repo stays clean, `git clean` is safe, and an
Electron build has an obvious per-user location to target.

### Agent turns

**There is no run entity.** The unit of agent work is a **turn inside a thread** (§4), and the
record of that work is the messages the turn writes. Nothing about a turn is persisted separately:
no run row, no event table, no run id, and no run monitor in the UI.

A turn executes as a **subprocess spawned from the API process**. An `AgentTurnManager` owns one
asyncio task per in-flight turn; the task spawns the agent subprocess with `cwd` set to the
project's **project folder** (§4), and streams its stdout into `Message` rows on the thread, which
are pushed to the UI over SSE.

```
uvicorn (FastAPI)
  └─ AgentTurnManager (asyncio)
       ├─ subprocess: agent "atlas"   cwd=~/repos/api-service          (source.kind=git)
       ├─ subprocess: agent "beacon"  cwd=~/.roster/projects/<id>      (source.kind=none)
       └─ messages → SQLite → SSE → UI
```

A turn starts when a message addressed to an agent is posted to a thread. Lead-agent coordination
uses the same mechanism: the lead agent posts messages that start other agents' turns. There is no
broker, no worker service, and no per-agent container.

**In-flight turns are the only source of `Working` status.** The manager holds the set of agents
currently taking a turn, and `GET /agents` reads it. This is consistent with §4's rule that agent
status is transient runtime state and never persisted.

Consequence, accepted: turns do not survive an API restart. An interrupted turn leaves its partial
messages in the thread and the thread stays open; the operator posts again to retry. Because
messages are the record, nothing needs reconciling on startup — there is no run row left in a
non-terminal state. For a local single-user tool this is a fair trade for removing a whole process
tier and an entire persisted entity.

### API contract

Every response uses the envelope `{success, data, error}`, with `meta` added for paginated
collections. A uniform envelope keeps client-side error handling in one place; routers are
written by hand rather than generated from a generic CRUD abstraction.

Status changes are validated by `domain/transitions.validate_transition`; an invalid
transition returns HTTP 409. Entity IDs are UUID hex strings; work items also carry a
human-readable key of the form `ROS-42`.

### No authentication

There is no auth layer, no `owner_id` column, and no owner scoping. The API binds to
localhost. If roster is ever exposed beyond the local machine, that is a new design
decision, not a configuration change.

---

## 4. Domain model

Derived from the data model in the UI handoff (`docs/design/README.md`), simplified for
local single-user operation.

| Entity | Storage | Notes |
|---|---|---|
| `Project` | DB | name, `source.kind` (`git`/`local`/`none`), source URL or path, resolved project-folder path, item count — see below |
| `WorkItem` | DB | type `epic`/`feature`/`task`; status `backlog`/`todo`/`in_progress`/`in_review`/`done`; priority; parent epic/feature; spec markdown; `agent_name` — the assigned agent, nullable |
| `Thread` | DB | the unit of agent work — belongs to a project, optionally to a work item; status; read flag — see below |
| `Message` | DB | append-only conversation and agent output: `author_kind`, `kind`, content, payload |
| `McpServer` | DB | connection config, per-tool toggles, per-agent access |
| `Secret` | DB | name + encrypted value, referenced by agents |
| `Attachment` | DB + disk | uploads and agent-produced files |
| `Agent` | **disk only** | read from `~/.roster/agents/<name>/`; never written to the DB |
| `ProjectMemory` | **disk only** | digest, journal, and snapshots under `<project folder>/.roster/memory/` — see §5 |
| `Artifact` | disk + DB row | files under `<project folder>/.roster/artifacts/`, indexed as `Attachment`s |

### Projects, source, and the `.roster` folder

A project is a **named body of work with a project folder** — one directory that agents run in.
It is not required to be, or contain, a git repository.

**Source is declared, not inferred.** At creation the operator picks one of three source kinds,
matching the design's `PROJECT TYPE` control:

| `source.kind` | Field | Project folder |
|---|---|---|
| `git` | remote URL, or the path of an existing local repository | the repository working tree |
| `local` | path to an existing folder | that folder |
| `none` | — | `~/.roster/projects/<project_id>/`, created by roster |

Declaring beats detecting here for one reason: detection cannot tell "this project has no code"
from "this project's folder happens to be empty", and those need different terminal behaviour.

**Every project folder gets a `.roster/` directory.** Memory and artifacts live inside the
project, not in a parallel tree keyed by ID:

```
<project folder>/
  .roster/
    memory/
      MEMORY.md      # compacted digest — see §5
      journal/       # append-only entries, one per resolved thread
      snapshots/     # previous digests
    artifacts/       # specs, notes, reports, agent-generated files
  …the project's own files…
```

The artifact store has no location choice: it is always `<project folder>/.roster/artifacts`.
Every project has one, including `source.kind = "none"` projects, which is the point — work with
no code still has a durable, reviewable home for its output.

**`.roster/` is not git-ignored.** When the project folder is a repository, memory and artifacts
are tracked like any other file, so they travel with the repo and show up in review. Roster
never commits on its own: it writes files, and those changes ride along in whatever commit the
agent makes. A compaction is not a commit.

**The thread lifecycle branches on source kind at the terminal step only:**

| `source.kind` | Terminal step | Deliverable |
|---|---|---|
| `git` | `pr` | a branch, commits (including anything written under `.roster/`), and an opened pull request |
| `local` or `none` | `deliver` | files written to `.roster/artifacts/`, registered as `Attachment`s, plus a summary posted to the work item's thread |

Everything before the terminal step — plan, work, verify, approval gates, the memory write — is
identical on all three. An agent on a research project writes documents and a summary; an agent
on a repository writes code and opens a PR. Neither path is the privileged one.

What this forces on the rest of the design:

- Nothing in `domain/` may assume a repository exists. Git is checked at the edge from the
  declared source kind, never an ambient assumption.
- A work item is not "a change to code". Its `spec` markdown states the task, whatever its
  nature, and its status vocabulary (`backlog` … `in_review` … `done`) is already generic.
- `Attachment` records point at files inside `.roster/artifacts/`; it is the general deliverable
  channel, not just an upload inbox.
- Agents get write access to `.roster/` in the project folder they are running in, and nowhere
  else under it that the task does not require.

### Threads, messages, and the unit of work

A **thread** is a conversation with agents and the record of the work they did in it. It replaces
the run as roster's unit of agent work: an agent takes turns inside a thread (§3), everything it
does is written to the thread as messages, and **resolving the thread is what writes project
memory** (§5).

```
Thread                                        Message
  id                                            id
  project_id                                    thread_id
  work_item_id: str | None                      author_kind: user | agent
  title                                         author_name: str | None   # agent folder name
  status: info | review_needed                  kind: text | file_write
        | action_needed | resolved                  | question | event
  read: bool                                    content: str
  created_at, updated_at                        payload: dict | None
  resolved_at: datetime | None                  created_at
```

**One entity, three surfaces.** `work_item_id` is nullable, and that single nullable field is what
lets the design's three thread surfaces share one table, one endpoint set, and one resolution rule:

| Surface | Query |
|---|---|
| Chat panel — the lead-agent conversation on every project screen | project's threads with no work item |
| Work Item Detail → Thread tab | the thread for that work item |
| Threads screen (global) | every thread, filtered by project and by All / Action Needed |

`status` carries exactly the four badge types in the design handoff's Threads screen, so the UI
renders a stored value rather than inferring one. Moves are validated by
`domain/threads.validate_transition` and an illegal move returns 409, matching how work-item status
already behaves. **The invariant that matters: a resolved thread cannot be resolved again** — that
is what stops a double memory write. Reopening is an explicit move back to `info`.

`participants`, `message_count`, `last_message`, and the list of files written are **derived from
messages in the list query, never stored**, so they cannot drift from the conversation they
describe.

**API:**

- `GET /threads` — filters `project_id`, `work_item_id`, `status`; `POST /threads` — create
- `GET /threads/{id}`; `PATCH /threads/{id}` — status (validated, 409 on an illegal move) and `read`
- `GET /threads/{id}/messages`; `POST /threads/{id}/messages` — posting a message addressed to an
  agent starts that agent's turn (§3)
- `POST /threads/mark-all-read`
- `GET /threads/{id}/stream` — SSE, carrying new messages as the turn writes them

The terminal step above is chosen by `domain/threads.terminal_step(source_kind)` — `pr` for a git
project, `deliver` otherwise — and applies when the thread resolves.

**Agents are folder-backed.** `AGENT.md`, `skills/`, and `config.yaml` on disk are the source
of truth; roster reads them and never stores agent configuration itself. Renaming an agent in
the UI renames its folder. Editing the model in the UI writes `config.yaml`. Agent status is
transient runtime state held in memory — **Working**, **Active**, or **Disabled** — and is not
persisted. There are no subagents anywhere in the model or the UI.

---

## 5. Project memory

Each project has a durable, compressed memory that outlives any single thread and is shared by
every agent working on that project. It is the project's accumulated context: how the codebase
is arranged, what conventions hold, what was decided and why, and which sharp edges have
already been discovered.

Memory is **project-scoped and shared** — there is no per-agent memory. Every agent assigned to
a project reads the same digest.

### Layout

```
<project folder>/.roster/memory/
  MEMORY.md                                   # compacted digest — what agents read
  journal/
    2026-08-01T14-22-03Z-thread-<thread_id>.md  # append-only, one file per resolved thread
  snapshots/
    2026-08-01T14-22-05Z-MEMORY.md            # digest as it was before a compaction
```

Memory sits inside the project it describes, alongside `.roster/artifacts/` (§4), so a project
carries its own context: copy or clone the folder and the memory comes with it. Where the project
folder is a repository, memory is tracked and reviewable like any other file.

Memory lives on disk rather than in the database because agents are filesystem-native: an agent
subprocess can read `MEMORY.md` directly, the same way it reads `AGENT.md`. Nothing about memory
requires a query engine.

### Read path

At the start of every turn the `AgentTurnManager` injects into the agent's context:

- the full contents of `MEMORY.md`, and
- any journal entries not yet folded into the digest.

It also exports `ROSTER_PROJECT_MEMORY` — the absolute path to the project's memory folder — so
an agent can re-read memory mid-turn. **Agents have read access to the whole memory folder;
only roster writes to it.** This keeps every write on one code path with one set of rules.

### Write path

**A thread moving to `resolved` is the one and only trigger.** It fires whether the work succeeded
or failed, since failures are exactly the context worth keeping — a thread resolved after a dead
end is as worth remembering as one resolved after a merge. Because the move to `resolved` is
rejected when the thread is already resolved (§4), the entry is written exactly once:

1. **Append.** Roster writes a **new** file in `journal/` covering what was done, what was
   learned, decisions made, and gotchas hit. The content is the agent's own summary when a turn in
   that thread produced one; otherwise it is derived from the thread — title, work item key,
   participating agents, and the paths from its `file_write` messages. Nothing existing is
   modified, so concurrent resolutions cannot conflict and no lock is needed on this path.
2. **Evaluate the trigger.** Compaction fires when the journal holds ≥ `memory_compact_entries`
   entries (default 10) **or** ≥ `memory_compact_bytes` of raw text (default 32 KB).
3. **Compact,** if triggered. The agent is invoked with the current digest plus every journal
   entry and asked to produce a replacement digest within `memory_digest_budget_bytes`
   (default 8 KB), using the agent's own configured model.
4. **Commit.** The current `MEMORY.md` is copied into `snapshots/` first; then the new digest
   is written atomically (temp file + rename), and only the journal entries that were fed into
   that compaction are deleted.

Compaction is serialized per project by an asyncio lock in the `AgentTurnManager`. Appends are not
locked — they are append-only by construction.

### Digest structure

`MEMORY.md` uses stable headed sections, so compaction has a target shape to preserve rather
than a blank page to improvise on:

```markdown
# <project> — project memory
## Overview            — what this codebase is and does
## Architecture        — structure, layering, key modules
## Conventions         — patterns to follow, patterns to avoid
## Decisions           — dated, with the reason
## Gotchas             — sharp edges, known failures, environment quirks
## Glossary            — project-specific terms
```

### Safety

Compression is lossy and is performed by an LLM, so the design assumes it will sometimes go
wrong:

- **The journal is the source of truth until compaction succeeds.** Entries are deleted only
  after the new digest is written. A compaction that fails, times out, or returns an empty or
  unparseable digest leaves `MEMORY.md` and the journal untouched; the next resolved thread
  retries. The failure is posted to the thread as an `event` message and surfaced in the UI —
  never swallowed, and never a reason to block the resolution.
- **Snapshots make a bad digest reversible.** The previous digest is retained before every
  compaction, keeping the most recent `memory_snapshot_keep` versions (default 20).
- **Writes are atomic.** Temp file plus rename, so a crash mid-write cannot leave a truncated
  digest.
- **A missing or unreadable digest is treated as empty**, not as an error that blocks a turn.

### API

- `GET /projects/{id}/memory` — digest plus pending-journal count
- `GET /projects/{id}/memory/journal` — uncompacted entries
- `POST /projects/{id}/memory/compact` — force a compaction regardless of threshold, without appending a journal entry. Returns `{digest, compacted, folded_entries}`: 200 when it compacts or when the journal is empty (a legitimate no-op), 503 when the compaction itself fails, with digest and journal left untouched. Resolution-triggered compaction differs deliberately — there a failure is non-fatal and the thread still resolves. This endpoint lives with the other memory routes, not with thread routes
- `GET /projects/{id}/memory/snapshots` and `POST /projects/{id}/memory/snapshots/{ts}/restore`

A UI surface for reading, editing, and reverting memory is deferred (§12); the design bundle
has no memory screen yet.

---

## 6. Frontend

React 18 + Vite + Tailwind 4, React Query for server state, React Router for routing, MSW for
mocking, and vitest + testing-library for unit tests. End-to-end testing is deferred (§12).

Structure:

```
projects/ui/src/
  app/              # shell: providers, router, layout, Sidebar, Topbar, ChatPanel, error boundary
  modules/          # feature slices (board, detail, threads, agents, mcp, dashboard, settings)
  components/ui/    # design-system primitives (Button, Modal, StatusBadge, Chip, …)
  lib/api/          # typed envelope client, per-domain modules, React Query key factories
  lib/hooks/        # useEventSource, useLocalStorage, useResizableWidth, …
```

Screens to build, per the handoff canvases: Issues List, Board, Work Item Detail (Spec /
Thread / Attachments / Activity tabs), Threads (All and Action Needed tabs plus a project
filter), Agents, Agent Detail (rename → renames the folder, `AGENT.md` editor, model picker
writing `config.yaml`), MCP Servers, MCP Server Detail (connection, per-tool toggles,
per-agent access, recent calls), Dashboard, Settings (Secrets), and the Create Project and
Create Work Item modals.

Sidebar navigation is Dashboard · Threads · Agents · MCP Servers, with the PROJECTS group
below carrying a `+` button.

**There is no run surface anywhere in the UI** — no run monitor, no log-stream tab, no step
timeline, no start-run button, and no run vocabulary in routes, components, or hooks. Live agent
output is read in the Thread tab (handoff §D3), which is the design's own decision and now the
model's as well (§3). Threads is therefore the screen agent work is *observed* through, not a
secondary view: it is backed by real endpoints, and project memory depends on it.

**Deviation from the handoff.** The design's Create Project modal carries a required
`ARTIFACT STORE` block (Artifact repo · Local folder · Same as project). Roster fixes that
location at `<project folder>/.roster/artifacts` (§4), so:

- The artifact-store block is **removed** from the modal. The modal keeps the `PROJECT TYPE`
  segmented control (Git repository · Local folder · No code) and its matching field exactly as
  designed.
- The artifact-store chip in the A/B topbar stays, but it is informational — it shows the path
  and opens the folder; it is not a picker.
- The sidebar keeps the design's icon rule as-is: git glyph for `source.kind = "git"`, plain
  folder glyph otherwise.

Mock-first is the default (`VITE_USE_MOCKS=true`), so the UI runs and is developed with no
backend. A live-API flag proxies `/api` to the local server.

Design tokens, layout dimensions, component states, and per-screen specifications come from
`docs/design/README.md`.

> **Implementation provenance:** the SPA at `../naaf/projects/ui` is a **source to harvest from,
> not a codebase to clone.** Structure, screens, and individual components are taken where they
> earn their place — the design tokens (already an exact match for the handoff), the envelope
> client, the primitive set, the thread components, the hooks, and the test configuration. Nothing
> is copied merely because it exists: anything that does not serve roster's design is deleted
> rather than stubbed, and code carrying removed concepts — runs, subagents, owner/auth, budget
> enforcement — does not come across at all. This is a one-time transplant, not a shared
> dependency, and nothing in roster's design derives from that project.

---

## 7. Error handling

- **API**: exception handlers map domain errors to the envelope's `error` field with an
  appropriate status — invalid transition 409, not found 404, validation 422. No error is
  swallowed; unexpected exceptions are logged with context and returned as 500 with a generic
  message.
- **Agent turns**: a subprocess that exits non-zero, times out, or cannot be spawned posts an
  `event` message to the thread carrying the reason, and the agent stops being `Working`. The
  thread stays open so the operator can retry by posting again. The failure is visible in the UI,
  never silent.
- **Agent folders**: a malformed `config.yaml` or missing `AGENT.md` surfaces the agent in the
  UI as Disabled with a readable reason, rather than crashing the listing.
- **Project memory**: a failed compaction leaves the digest and journal intact and records the
  reason as an `event` message on the thread; a missing or unreadable digest is treated as empty
  rather than failing the turn. Memory problems never block a thread from resolving.
- **UI**: an error boundary at the shell, per-query error states, and explicit SSE reconnect
  handling with backoff.

---

## 8. Testing

- **Unit** — domain rules (transitions, hierarchy), agent-folder parsing, envelope helpers,
  and the compaction trigger rules in `domain/memory.py`.
- **Integration** — API routers against a real SQLite database via httpx; turn lifecycle driven
  through `FakeRuntime`; SSE streams asserted end to end. Memory gets its own cases: concurrent
  thread resolutions appending without loss, resolving an already-resolved thread returning 409
  without a second journal entry, compaction firing at the threshold, a failed compaction leaving
  digest and journal untouched, and snapshot restore.
- **Frontend** — vitest + testing-library for primitives, hooks, and screens against MSW.
- 80% coverage gate on the backend, enforced by `make coverage` and CI.
- TDD: the failing test is written first; AAA structure; descriptive behavior names.

---

## 9. Developer workflow

```bash
make install      # uv sync + pnpm install
make dev          # API (SQLite, migrated + seeded) + UI, one command
make run          # API only
make test         # pytest
make coverage     # 80% gate
make lint         # ruff + mypy + eslint + tsc
make db-upgrade   # alembic upgrade head
```

No Docker is required to run roster. Commits follow `<type>: <description>`
(feat/fix/refactor/docs/test/chore/perf/ci). Work happens in a git worktree under
`.worktrees/` and ships via a reviewed PR once the repo has a remote.

---

## 10. Non-goals

Roster is a local tool, and the following are out of scope by design. Each is listed so that
future work does not reintroduce it by reflex:

| Not building | Why |
|---|---|
| Task queue / scheduler tier (Celery, RQ, cron workers) | Agent turns are asyncio tasks in the API process |
| Message broker or pub/sub bus | The `AgentTurnManager` talks to subprocesses directly |
| A persisted run / job / execution entity | The thread is the unit of work and its messages are the record |
| Containerised agent execution | Agents are local subprocesses on a trusted machine |
| Client/server database (Postgres, MySQL) | One user, one machine — a SQLite file |
| Shared workspace libraries | Single package; extract only when a second consumer exists |
| Generic CRUD router generation | Routers are written by hand |
| Authentication, tenancy, owner scoping | Single user, bound to localhost |
| Sandboxing, egress proxying, hosted git-app tokens | Local trust model |
| Budget enforcement | Token usage is displayed, not enforced |
| Horizontal scaling, multi-node coordination | Not a distributed service |
| Vector store / embedding retrieval over memory | Memory is a small compacted digest read in full, not a corpus to search |
| Per-agent private memory | Memory is project-scoped and shared; agents differ by instructions and skills, not recall |
| Non-git version control (svn, hg) | `source.kind = "local"` covers any other folder |
| A configurable artifact-store location | Always `<project folder>/.roster/artifacts` |
| A remote artifact repository separate from the project | Artifacts live with the project; a git project versions them in its own repo |
| Roster committing or pushing on its own | Roster writes files; agents commit them as part of their normal work |

---

## 11. Decisions recorded

1. **Light hexagonal, one package** — testable layering without port/adapter ceremony.
2. **`projects/` layout** — server and UI as sibling projects; the workspace allows a later
   library extraction without restructuring.
3. **Subprocesses from the API process** — no broker, no worker tier, no containers.
4. **Async-only SQLAlchemy on SQLite** — keeps streaming routes off blocking sessions.
5. **Uniform `{success, data, error}` envelope** — one place for client error handling.
6. **Alembic from the start** — projects and threads are real user data worth migrating.
7. **`~/.roster/` data root** — keeps the repo clean and gives Electron an obvious target.
8. **Mock-first UI** — screens are developed and tested without a running backend.
9. **Project memory as journal + compacted digest on disk** — appends are concurrency-safe by
   construction, compaction is a separate retryable step, and snapshots make lossy compression
   reversible. Memory is project-scoped and shared by all agents; only roster writes it.
10. **Projects are folders, not repositories** — every project is a folder agents work in.
    Source kind is declared at creation (`git` / `local` / `none`) because detection cannot
    distinguish "no code" from "empty folder"; it swaps the thread's terminal step between `pr`
    and `deliver`. No domain code assumes a repo.
11. **Memory and artifacts consolidate into `<project folder>/.roster/`** — one place per
    project rather than a parallel tree keyed by ID, so context and output travel with the
    project. `.roster/` is tracked by git when the project is a repo; roster writes files but
    never commits them itself.
12. **Ports live in `adapters/`, not `domain/`** — domain imports the protocol and receives an
    implementation by injection, so storage can change without touching roster rules. Entry points
    and orchestration live in `interactors/`. The layer test: would it make sense in a different
    product (adapter), does it encode how roster works (domain), or is it how the outside world
    gets in (interactor)?
13. **The `FileStore` port is rooted** — containment is enforced once, inside the store, on every
    operation, rather than re-checked by each caller. This is where the Task 9 traversal and
    symlink hardening ended up, and it now covers every file read rather than `restore()` alone.
14. **Repository + UnitOfWork replaces bare query functions** (reversal of an earlier decision).
    The original spec ruled these out as ceremony. Reversed on the operator's call: a proven
    pattern already in use elsewhere, giving one transaction boundary per request rather
    than per-call commits, and a single place to change query behaviour. Adapted rather than
    copied — async-only (no sync sibling), no `required_filters` owner-scoping since roster has
    no auth, and the generic base lives in `adapters/db/` rather than a workspace library.
15. **The project-folder store is rooted at `/`, deliberately** — an accepted widening of (13),
    recorded here so it is a decision rather than an implementation detail. An operator declaring
    a `local` or `git` project is naming a folder on their own machine, and a repo at `/opt/src/x`
    or on another volume is an ordinary case. Rooting that one store at the data root rejected
    those folders and — worse — reported them as "does not exist", which is false.
    **The consequence, stated plainly:** an unauthenticated `POST /projects` on localhost can
    create a `.roster/` subtree inside any existing directory the operator can write to. That is
    accepted under §1's trust model — single user, single machine, no auth, no tenancy — where the
    caller is already the operator. It creates directories only; it never reads, overwrites, or
    deletes anything that was already there.
    **This is not a general relaxation.** It applies to exactly one store, used once, on one
    operator-supplied path, and never to a name an agent can choose. Everything an agent names
    stays contained: agent folders remain rooted at the data root, and each project's memory
    remains rooted at its own `.roster/memory`. If roster ever grows a remote listener or a second
    user, this decision is the first thing that has to be revisited.
16. **The thread is the unit of agent work; there is no run entity** (2026-08-02, supersedes the
    original run design). An agent takes *turns* inside a thread and the messages it writes are the
    only record — no run row, no event table, no run monitor. This removes an entity, two tables,
    and a whole UI surface, and it matches the design handoff, which had already deleted the agent
    monitor tab in favour of the Thread tab. The cost is accepted deliberately: turn history does
    not survive a restart, because the conversation does.
17. **Resolving a thread is the single memory write trigger.** Memory previously hung off run
    completion; with runs gone it hangs off the move to `resolved`, and that move is rejected when
    the thread is already resolved — so the journal entry is written exactly once, enforced by a
    domain rule rather than by care. Threads therefore stop being an optional screen: project
    memory does not work without them.
18. **`WorkItem` carries `agent_name`.** The design shows an assigned agent on every list row,
    kanban card, and detail header. Assignment is a property of the work item rather than something
    inferred from whichever agent last posted, so the board renders from stored data instead of
    reconstructing intent from a conversation.

---

## 12. Out of scope for the setup work

Deferred to follow-up plans, each with its own spec:

- The screen-by-screen build-out (Threads, Agents, MCP, work-item detail tabs)
- `SubprocessRuntime` — the real agent runtime and lead-agent coordination protocol
- MCP server connection handling and per-tool permissions
- An end-to-end test suite and its CI workflow. Deferred deliberately, not forgotten: the journey worth covering (create project → create work item → post a message that starts an agent turn → observe messages stream in → resolve the thread and see the journal entry) only becomes meaningful once the screens in the deferred UI build-out exist. Revisit when they do — it is the only check that would catch the UI and the API disagreeing.
- Cloning a remote git source. Setup accepts and validates a `source.kind = "git"` remote URL and
  records it; the clone into the project folder lands with `SubprocessRuntime`, since that is the
  first thing that needs a working tree on disk. A `git` project pointed at an existing local
  repository path works from day one.
- The memory UI — reading, hand-editing, and reverting a project's digest (no screen exists in
  the design bundle yet); the API in §5 lands first
- Tuning compaction prompt quality and the digest budget against real project history
- Secrets encryption at rest
- Electron packaging
