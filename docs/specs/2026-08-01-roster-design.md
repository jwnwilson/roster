# Roster — Design Spec

**Date:** 2026-08-01
**Status:** Approved

---

## 1. Overview

Roster is a **single-user, local-only agent manager** with a Linear-style project
management UI. The operator sets up multiple agents on their own machine and coordinates
them through a **lead agent**, driving work from a board of projects → epics → features →
tasks.

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
the agent-folder reader and a fake runtime are in place; CI is green; and `CLAUDE.md`,
`docs/architecture.md`, and ADR-0001 are written.

---

## 2. Repository structure

```
roster/
  CLAUDE.md                 # stack, conventions, worktree→PR workflow
  Makefile                  # install dev run test coverage lint db-upgrade e2e
  pyproject.toml            # uv workspace, single member: projects/server
  .env.example  .gitignore
  .github/workflows/{ci,e2e}.yml
  docs/
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
        domain/             # pure entities + rules — no I/O, no adapter imports
        adapters/
          db/               # SQLAlchemy models, session factory, query modules, migrations
          agents/           # agent-folder reader + runtime implementations
        api/                # app factory, routers, deps, SSE, settings
        cli/                # seed
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

**`domain/`** — Pydantic entities and pure rules: status transitions, work-item hierarchy,
thread/message rules. No argparse, no I/O, no adapter imports. Each entity model is
co-located in the domain module that owns it; there is no central `models.py`. Entities are
updated via `model_copy(update={...})` and never mutated.

**`adapters/db/`** — SQLAlchemy declarative models, an async session factory, and per-domain
query modules that take an `AsyncSession` argument directly. There are **no** `Repository` or
`UnitOfWork` protocols and no generic CRUD abstraction; queries are written out.

**`adapters/agents/`** — the agent-folder reader and the runtime. An `AgentRuntime` protocol
with two implementations: `SubprocessRuntime` (real) and `FakeRuntime` (used by tests and
the default `make dev`).

**`api/`** — FastAPI wiring: app factory, one hand-written router per resource, the session
dependency, SSE endpoints, settings.

**`cli/`** — the seed entry point. There is no `scripts/` folder.

### Why async-only

SSE endpoints hold a connection open for the lifetime of a run. A synchronous database
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
```

Keeping data out of the repo means the repo stays clean, `git clean` is safe, and an
Electron build has an obvious per-user location to target.

### Run execution

Agent runs execute as **subprocesses spawned from the API process**. A `RunManager` owns one
asyncio task per run; the task spawns the agent subprocess with `cwd` set to the project's
repository, streams its stdout into `RunEvent` rows, and pushes those events to the UI over
SSE.

```
uvicorn (FastAPI)
  └─ RunManager (asyncio)
       ├─ subprocess: agent "atlas"   cwd=~/repos/api-service
       ├─ subprocess: agent "beacon"  cwd=~/repos/api-service
       └─ events → SQLite → SSE → UI
```

Lead-agent coordination uses the same mechanism: the lead agent spawns and messages
sub-agent runs through the `RunManager`. There is no broker, no worker service, and no
per-agent container.

Consequence, accepted: runs do not survive an API restart. In-flight runs are marked failed
on startup and can be restarted from the UI. For a local single-user tool this is a fair
trade for removing a whole process tier.

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
| `Project` | DB | name, repo path/URL, item count |
| `WorkItem` | DB | type `epic`/`feature`/`task`; status `backlog`/`todo`/`in_progress`/`in_review`/`done`; priority; parent epic/feature; spec markdown; token usage |
| `Thread` | DB | conversation scope: global, project, or work-item |
| `Message` | DB | role `user`/`agent`/`lead_agent`, content, attachments |
| `Run` | DB | agent + work item, status, timing, token usage, cost |
| `RunEvent` | DB | append-only stream: tool calls, results, status changes |
| `McpServer` | DB | connection config, per-tool toggles, per-agent access |
| `Secret` | DB | name + encrypted value, referenced by agents |
| `Attachment` | DB + disk | uploads and agent-produced files |
| `Agent` | **disk only** | read from `~/.roster/agents/<name>/`; never written to the DB |

**Agents are folder-backed.** `AGENT.md`, `skills/`, and `config.yaml` on disk are the source
of truth; roster reads them and never stores agent configuration itself. Renaming an agent in
the UI renames its folder. Editing the model in the UI writes `config.yaml`. Agent status is
transient runtime state held in memory — **Working**, **Active**, or **Disabled** — and is not
persisted. There are no subagents anywhere in the model or the UI.

---

## 5. Frontend

React 18 + Vite + Tailwind 4, React Query for server state, React Router for routing, MSW for
mocking, vitest + testing-library for unit tests, Playwright for E2E.

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

Mock-first is the default (`VITE_USE_MOCKS=true`), so the UI runs and is developed with no
backend. A live-API flag proxies `/api` to the local server.

Design tokens, layout dimensions, component states, and per-screen specifications come from
`docs/design/README.md`.

> **Implementation provenance:** the shell, primitive set, API client, hooks, MSW layer, and
> test configuration are copied from the existing SPA at `../naaf/projects/ui` as a starting
> point, then renamed and reworked to the structure and screens above. This is a one-time code
> transplant, not a shared dependency — nothing in roster's design derives from that project.

---

## 6. Error handling

- **API**: exception handlers map domain errors to the envelope's `error` field with an
  appropriate status — invalid transition 409, not found 404, validation 422. No error is
  swallowed; unexpected exceptions are logged with context and returned as 500 with a generic
  message.
- **Agent runs**: a subprocess that exits non-zero, times out, or cannot be spawned marks the
  run failed and records a terminal `RunEvent` carrying the reason. The failure is visible in
  the UI, never silent.
- **Agent folders**: a malformed `config.yaml` or missing `AGENT.md` surfaces the agent in the
  UI as Disabled with a readable reason, rather than crashing the listing.
- **UI**: an error boundary at the shell, per-query error states, and explicit SSE reconnect
  handling with backoff.

---

## 7. Testing

- **Unit** — domain rules (transitions, hierarchy), agent-folder parsing, envelope helpers.
- **Integration** — API routers against a real SQLite database via httpx; run lifecycle driven
  through `FakeRuntime`; SSE streams asserted end to end.
- **Frontend** — vitest + testing-library for primitives, hooks, and screens against MSW.
- **E2E** — Playwright over a scripted journey: create project → create work item → start a
  run against `FakeRuntime` → observe events → resolve the item.
- 80% coverage gate on the backend, enforced by `make coverage` and CI.
- TDD: the failing test is written first; AAA structure; descriptive behavior names.

---

## 8. Developer workflow

```bash
make install      # uv sync + pnpm install
make dev          # API (SQLite, migrated + seeded) + UI, one command
make run          # API only
make test         # pytest
make coverage     # 80% gate
make lint         # ruff + mypy + eslint + tsc
make db-upgrade   # alembic upgrade head
make e2e          # Playwright
```

No Docker is required to run roster. Commits follow `<type>: <description>`
(feat/fix/refactor/docs/test/chore/perf/ci). Work happens in a git worktree under
`.worktrees/` and ships via a reviewed PR once the repo has a remote.

---

## 9. Non-goals

Roster is a local tool, and the following are out of scope by design. Each is listed so that
future work does not reintroduce it by reflex:

| Not building | Why |
|---|---|
| Task queue / scheduler tier (Celery, RQ, cron workers) | Runs are asyncio tasks in the API process |
| Message broker or pub/sub bus | The `RunManager` talks to subprocesses directly |
| Containerised agent execution | Agents are local subprocesses on a trusted machine |
| Client/server database (Postgres, MySQL) | One user, one machine — a SQLite file |
| Shared workspace libraries | Single package; extract only when a second consumer exists |
| `Repository` / `UnitOfWork` abstractions | Query functions taking an `AsyncSession` |
| Generic CRUD router generation | Routers are written by hand |
| Authentication, tenancy, owner scoping | Single user, bound to localhost |
| Sandboxing, egress proxying, hosted git-app tokens | Local trust model |
| Budget enforcement | Token usage is displayed, not enforced |
| Horizontal scaling, multi-node coordination | Not a distributed service |

---

## 10. Decisions recorded

1. **Light hexagonal, one package** — testable layering without port/adapter ceremony.
2. **`projects/` layout** — server and UI as sibling projects; the workspace allows a later
   library extraction without restructuring.
3. **Subprocesses from the API process** — no broker, no worker tier, no containers.
4. **Async-only SQLAlchemy on SQLite** — keeps streaming routes off blocking sessions.
5. **Uniform `{success, data, error}` envelope** — one place for client error handling.
6. **Alembic from the start** — projects and threads are real user data worth migrating.
7. **`~/.roster/` data root** — keeps the repo clean and gives Electron an obvious target.
8. **Mock-first UI** — screens are developed and tested without a running backend.

---

## 11. Out of scope for the setup work

Deferred to follow-up plans, each with its own spec:

- The screen-by-screen build-out (Threads, Agents, MCP, work-item detail tabs)
- `SubprocessRuntime` — the real agent runtime and lead-agent coordination protocol
- MCP server connection handling and per-tool permissions
- Secrets encryption at rest
- Electron packaging
