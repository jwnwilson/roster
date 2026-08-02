# Roster

A **single-user, local-only agent manager** with a Linear-style project management UI. Set up
multiple agents on your own machine and coordinate them through a **lead agent**, driving work
from a board of projects → epics → features → tasks. Agents run as local subprocesses, read and
write a per-project memory, and leave their output in the project's own `.roster/artifacts`
folder.

Roster is **not a distributed service**: one machine, one person, no tenancy, no auth, no broker,
no containers. It could be wrapped in Electron later.

- **Where we are (read first): [docs/project-history.md](docs/project-history.md)**
- Design spec: [docs/specs/2026-08-01-roster-design.md](docs/specs/2026-08-01-roster-design.md)
- Current plan: [docs/superpowers/plans/2026-08-01-roster-setup.md](docs/superpowers/plans/2026-08-01-roster-setup.md)
- UI design handoff: [docs/design/README.md](docs/design/README.md)

## Workflow (read first)

- **The spec is the authority.** Where code, this file, or a plan disagrees with
  `docs/specs/2026-08-01-roster-design.md`, the spec wins — stop and flag the conflict rather
  than quietly picking one.
- **TDD, always.** Write the failing test, run it and watch it fail, write the minimal
  implementation, watch it pass, commit. Tests use AAA structure and descriptive behaviour names.
- **One PR = one focused change** with a clear `<type>: <description>` title, a summary, and a
  test plan. Keep unrelated edits out.
- Before finishing any piece of work, `make lint` and `make coverage` (80% gate) must be green,
  plus `pnpm lint` and `pnpm test` if the UI changed.
- **This repository has no remote yet**, so work currently lands on `main` directly. Once a remote
  exists, switch to the worktree → PR flow: start each task in `git worktree add -b <type>/<slug>
  .worktrees/<slug> origin/main`, do the work there, push with `-u`, open a PR with `gh pr create`,
  and let `main` advance only by merge. Never `git clone` or `cp -r` this repo to get an isolated
  workspace — use a worktree.
- Commits use `<type>: <description>` — feat/fix/refactor/docs/test/chore/perf/ci. No attribution
  trailers.

## Stack

- Python ≥ 3.12, package manager `uv`
- FastAPI + uvicorn, Pydantic v2, pydantic-settings (env prefix `roster_`)
- SQLAlchemy 2.0 **async only** + SQLite (`aiosqlite`, WAL), Alembic migrations
- Agent runs are asyncio-managed **subprocesses inside the API process** — no Celery, no Redis,
  no broker, no worker service, no Docker
- React 18 + Vite + Tailwind 4 + React Query + React Router, MSW for mocks
- pytest + pytest-asyncio + httpx, 80% coverage gate; vitest + testing-library (end-to-end testing deferred)

## Architecture

**Light hexagonal, one package.** Domain logic never touches I/O, without port/adapter ceremony.

```
projects/
  server/src/
    domain/        # roster's rules and entities — projects, work items, transitions,
                   #   agents (folder parsing), memory (digest/journal/compaction), runs
    adapters/      # project-agnostic infrastructure + the ports it implements
      storage/     #   ports.py (FileStore protocol), local.py, memory.py (in-memory, for tests)
      db/          #   SQLAlchemy models, session factory, per-entity query functions
      agents/      #   AgentRuntime (FakeRuntime now, SubprocessRuntime later)
    interactors/   # entry points and orchestration — where the outside world comes in
      api/         #   app factory, routers, deps, errors, envelope, SSE
      cli/         #   seed
      runs/        #   RunManager — one asyncio task per run
    config/        # settings — neutral module, importable by every layer
  ui/
    app/           # shell: providers, router, layout, Sidebar, Topbar, ChatPanel, error boundary
    modules/       # feature slices (board, detail, threads, agents, mcp, dashboard, settings)
    components/ui/ # design-system primitives
    lib/api/       # typed envelope client + React Query key factories
    lib/hooks/     # useEventSource, useLocalStorage, …
```

### Placement rules

The test for which layer something belongs in: **would it still make sense in a different
product?** If yes it is an adapter. If it encodes how *roster* works, it is domain. If it is how
the outside world gets in, it is an interactor.

- **`domain/`** — roster's rules and entities. Knows *what* an agent folder means, *when* memory
  compacts, *where* a project folder resolves. Performs **no I/O itself**: it may import **port
  protocols** from `adapters/` and receives an implementation by injection. Never imports a
  concrete adapter, `interactors/`, or `config/` — thresholds and paths arrive as plain arguments.
  Each entity model is co-located in the module that owns it; there is no central `models.py`.
- **`adapters/`** — infrastructure that is not about roster: how to read a file, talk to a
  database, run a subprocess, call an API. **Ports live here with their implementations**, so
  domain can import the protocol. An adapter must contain no roster rules — if you find yourself
  writing "if the config is malformed, disable the agent" in an adapter, that belongs in domain.
- **`interactors/`** — entry points and orchestration: HTTP routers, the CLI, the run manager.
  This is the only layer that may import from everywhere. It wires a concrete adapter into domain
  logic and drives it.
- **`config/`** — settings only, importable by any layer except domain.

**Dependency direction:** `interactors → domain → adapter ports`, and `interactors → adapters` for
construction. **No adapter imports `interactors/` or `domain/` rules.** No `scripts/` folder.

**Database access goes through the UnitOfWork.** `adapters/db/` provides a generic
`AsyncSqlRepository[DTO]` base, one thin subclass per entity binding an ORM model to a domain DTO,
and an `AsyncUnitOfWork` owning a single session and transaction boundary with the repositories
exposed as properties. Interactors depend on the `UnitOfWork` protocol rather than on
`AsyncSession` directly, so a request or a run is one atomic scope. Routers are still written by
hand — there is no generic CRUD router.

**Storage is injected, never assumed.** Anything touching files goes through the `FileStore` port,
which is rooted: paths resolving outside the root raise `FileNotFoundError`. Containment is a
property of the store, applied to every operation — callers do not re-check it, and domain logic
never touches `pathlib` I/O directly.

**Nothing in `domain/` may assume a git repository exists.** A project declares its source as
`git`, `local`, or `none`; git is checked at the edge and only swaps the run's terminal step
between `pr` and `deliver`.

## The `.roster` folder contract

Every project folder contains one:

```
<project folder>/
  .roster/
    memory/
      MEMORY.md      # compacted digest — injected into every run
      journal/       # append-only, one entry per finished run
      snapshots/     # previous digests, written before each compaction
    artifacts/       # specs, notes, reports, agent-generated files
```

- **Roster is the only writer.** Agents read memory; they never write it directly.
- **Appends never overwrite** — that is what makes concurrent runs safe. Compaction is a separate,
  retryable step that snapshots the old digest first and deletes only the entries it folded in.
- A failed compaction is a **no-op**, not a partial write. Journal and digest survive; the next
  finished run retries.
- `.roster/` is **not git-ignored**. When the project folder is a repo, memory and artifacts are
  tracked and travel with it. Roster writes files but never commits them itself.
- Projects with `source.kind = "none"` get a managed folder at `~/.roster/projects/<id>/`.

## Key conventions

- **Immutability**: Pydantic models are updated via `model_copy(update={...})`, never mutated.
  (SQLAlchemy rows inside an adapter are the one exception — that is how the ORM works.)
- **API envelope**: every response is `{success, data, error}`, plus `meta` for pagination. 204s
  have no body.
- **Async only**: no synchronous engine, session, or import. Every DB call is awaited.
- **Status changes** go through `domain/transitions.validate_transition` — invalid transitions
  return HTTP 409.
- **IDs** are UUID hex strings (32 chars); work items also carry a human key `ROS-<n>`.
- **Settings** are read only through `config/settings.py` (prefix `roster_`), never `os.environ`.
- **Errors are never swallowed.** Domain errors map to specific statuses; unexpected exceptions
  are logged with context and returned as a 500 with a generic message. Memory failures surface as
  `RunEvent`s and never block a run from finishing.
- **No `naaf`** anywhere under `projects/`. The UI was transplanted from that codebase once; the
  name should not survive it.

## Dev commands

```bash
make install      # uv sync + pnpm install
make dev          # migrate + seed + API (:8000) + UI (:5173)
make run          # API only
make test         # pytest
make coverage     # 80% gate
make lint         # ruff + mypy
make db-upgrade   # alembic upgrade head

cd projects/ui && pnpm dev    # UI alone, fully mocked (VITE_USE_MOCKS=true)
```

No Docker is required to run roster.

## Status

Design and implementation plan are complete; no code has been written yet. See
[docs/project-history.md](docs/project-history.md) for what ships, what is designed-only, and what
comes next.
