# Roster — Project History & Status

> **Read this first.** A concise record of what has been built, what is designed-only, and what
> comes next. Append a new dated `## Status` section at the top of the log for each meaningful
> change; keep **Current state** and **Outstanding** accurate as you go.

## What roster is

A single-user, local-only agent manager with a Linear-style project management UI. The operator
sets up multiple agents on their own machine and coordinates them through a lead agent, driving
work from a board of projects → epics → features → tasks. Agents run as local subprocesses, read a
per-project compressed memory, and leave their output in the project's own `.roster/artifacts`
folder. A project is any body of work — a git repository, a plain folder, or no code at all.

Roster is deliberately not a distributed service: one machine, one person, no tenancy, no auth,
no broker, no containers.

- Conventions and layering: [../AGENTS.md](../AGENTS.md)
- Design spec: [specs/2026-08-01-roster-design.md](specs/2026-08-01-roster-design.md)
- Backend plan: [superpowers/plans/2026-08-01-roster-setup.md](superpowers/plans/2026-08-01-roster-setup.md)
- UI plan: [superpowers/plans/2026-08-02-roster-ui.md](superpowers/plans/2026-08-02-roster-ui.md)
- UI design handoff: [design/README.md](design/README.md)
- ADRs: [adr/](adr/)

## Current state (2026-08-02)

**The backend is nearly complete; no UI exists yet.** Work runs on two branches: `feat/setup`
(backend, PR #1) and `feat/ui` (not started).

What ships on `feat/setup` — **120 tests, 88.89% coverage** against an 80% gate:

- **Repository and toolchain** — uv workspace, ruff + mypy clean, `make lint` / `test` / `coverage` / `run` / `db-upgrade`.
- **Settings** in a neutral `config/` module (env prefix `roster_`), data root at `~/.roster`.
- **Async SQLite** via SQLAlchemy 2.0 + aiosqlite, with Alembic migrations (`0001_initial`, `0002_runs`).
- **Domain layer** — projects with declared source kinds, work items with epic→feature→task hierarchy and `ROS-<n>` keys, status transitions, agents, memory rules, run terminal-step selection.
- **Projects API** — create against all three source kinds, each scaffolding `<project folder>/.roster/{memory,artifacts}`. Deleting a project forgets it without touching the operator's files.
- **Work items API** — creation, project-scoped listing, status transitions returning 409 on an illegal move and 422 on a malformed one.
- **Agents read from disk** — `AGENT.md`, `skills/`, `config.yaml`. A broken folder becomes a Disabled agent with a readable reason and never breaks the listing.
- **Project memory** — append-only journal, compacted digest, snapshots, with a manual compaction endpoint distinguishing success, no-op, and failure.
- **Runs** — a `RunManager` owning one asyncio task per run, a `FakeRuntime`, SSE event streaming, and a post-run memory write that fires on failure as well as success.

Not yet done on the backend: **Task 12**, the layering refactor — moving agent, memory, and
project-folder logic into `domain/` behind a rooted `FileStore` port, and introducing `interactors/`
for entry points and orchestration.

## Status (2026-08-02) — UI split into its own plan

The UI work left the backend plan for [its own plan and branch](superpowers/plans/2026-08-02-roster-ui.md),
so the two can proceed in parallel. The split was driven by an inventory rather than a hunch: the
SPA being transplanted is ~8,400 lines of source across 18 primitives and 6 modules, but roster's
design needs `threads` (a rework of `inbox`) plus `agents` and `mcp`, which have no equivalent to
transplant — roughly two-thirds reuse, one-third new build.

**The decision that shapes that plan:** half the designed screens have no backend. Threads, MCP
servers, attachments, and secrets have no persistence in the backend plan. They will be built
against mocks anyway, so the screen shapes settle before their APIs are designed. The risk is that
"it works" stops meaning anything, so the plan carries an explicit `DATA_SOURCES` registry,
physically segregated MSW handler directories, a test asserting the two agree, and a dev-only badge
showing each screen's data source.

**End-to-end testing was descoped** in the same pass. The plan had promised a Playwright journey
and an `e2e.yml` workflow, but no task ever wrote either — `make e2e` would have run an empty suite.
Recorded in spec §12 as deferred with its trigger: the journey only becomes meaningful once the
deferred screens exist.

## Status (2026-08-02) — architecture revised mid-flight

Two changes to the layering, both recorded in spec §3 and §11:

- **Settings moved to a neutral `config/` module.** The plan's own constraint said domain imports
  nothing from `api/`, while its code had `domain/memory.py` importing `Settings` from
  `api.settings`. Domain functions now take plain values.
- **A layered refactor was inserted as Task 12**: agent-folder parsing, memory compaction, and
  project-folder resolution move into `domain/` behind a **rooted `FileStore` port** living in
  `adapters/storage/`; `interactors/` takes the API, CLI, and run manager. The layer test is
  written down in `AGENTS.md` so future work does not re-derive it — *would this make sense in a
  different product?* (adapter), *does it encode how roster works?* (domain), *is it how the
  outside world gets in?* (interactor).

The refactor also strengthens a security control: the traversal and symlink hardening built for
`restore()` becomes root containment inside the store, covering **every** file read rather than one
function.

## Status (2026-08-02) — backend Tasks 1–11 built

Executed task-by-task, each with a fresh implementer and an independent reviewer. Five fix rounds
across eleven tasks; two findings parked with written rulings.

**The pattern worth recording: nearly every defect originated in the plan, not the implementation.**
Implementers transcribed faithfully; the reviews and an instruction to audit sample code before
trusting it are what caught these:

- **Four crash paths in the agent reader** — a non-numeric `token_limit` or `temperature`, or an
  unreadable `AGENT.md`/`config.yaml`, threw out of `read_agents` and would have returned 500 for
  the entire `/agents` endpoint rather than disabling one agent. Fixed with a categorical guard.
- **Two data-loss bugs in the memory store**, found by the implementer auditing the plan's sample
  code before writing it: `UnicodeDecodeError` escaping `read_digest`, and one unreadable journal
  entry blinding the whole journal.
- **A path traversal in `restore()`** — `restore("../../../secret.txt")` read arbitrary files into
  `MEMORY.md`. Fixed with an allowlist; defeat-testing then found a symlink bypass of the allowlist,
  fixed with a resolve check.
- **A vacuous security test** — the traversal test specified in the plan passed against a completely
  unhardened `restore()`, because the attack string is rejected by routing before reaching the
  store. Caught by stubbing the implementation and watching the test not notice.
- **Validation errors returning 500** instead of 422, and an invalid status *value* returning 409
  (a domain-rule status) rather than 422.

Where the plan and the spec disagreed, the spec won each time — that tie-break, written in
`AGENTS.md`, resolved four separate conflicts without needing a judgement call.

## Status (2026-08-01) — design

Design spec written and revised five times: initial architecture; made self-contained; project
memory added (§5); projects generalised beyond git repositories; memory and artifacts consolidated
into `<project folder>/.roster/`. The UI design handoff was imported and updated to the
artifact-store revision, rebranded except for the two `.dc.html` canvases, which are byte-identical
to the delivered files.

## Outstanding

**Backend** — Task 12 only: the `FileStore` port, the domain move, and `interactors/`.

**UI** — all 14 tasks. Transplant, design tokens, shell, the live/mocked registry, then screens.

**Deferred beyond both plans**, each needing its own spec:

- `Thread`, `Message`, `McpServer`, `Secret`, `Attachment` persistence and endpoints — until these
  exist, their screens stay fixtures
- Agent write endpoints (rename, edit `AGENT.md`, model change)
- `SubprocessRuntime` — the real agent runtime and the lead-agent coordination protocol
- Cloning a remote git source into the project folder
- The memory UI — reading, hand-editing, and reverting a digest
- An end-to-end suite and its CI workflow
- Secrets encryption at rest
- Electron packaging

**Known open items** carried for the final review: `make install` references `projects/ui` before
the UI plan creates it; a CI shell exporting `roster_*` vars could shift asserted defaults; two
settings-isolation tests depend on file execution order; `next_sequence` + `insert_work_item` are
not atomic under concurrent creates. **Parked with a ruling:** a hardlink inside the snapshots
directory bypasses the resolve check, but requires local filesystem access that already implies
direct read of the target — unreachable by an HTTP caller.
