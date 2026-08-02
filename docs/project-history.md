# Roster — Project History & Status

> **Read this first.** A concise record of what has been built, what is designed-only, and what
> comes next. Append a new dated `## Status` section at the top of the log for each meaningful
> change; keep **Current state** and **Outstanding** accurate as you go.

## What roster is

A single-user, local-only agent manager with a Linear-style project management UI. The operator
sets up multiple agents on their own machine and coordinates them through a lead agent, driving
work from a board of projects → epics → features → tasks. Agents run as local subprocesses, read
a per-project compressed memory, and leave their output in the project's own `.roster/artifacts`
folder. A project is any body of work — a git repository, a plain folder, or no code at all.

Roster is deliberately not a distributed service: one machine, one person, no tenancy, no auth,
no broker, no containers.

- Conventions and layering: [../AGENTS.md](../AGENTS.md)
- Design spec: [specs/2026-08-01-roster-design.md](specs/2026-08-01-roster-design.md)
- Current plan: [superpowers/plans/2026-08-01-roster-setup.md](superpowers/plans/2026-08-01-roster-setup.md)
- UI design handoff: [design/README.md](design/README.md)
- ADRs: [adr/](adr/)

## Current state (2026-08-02)

**Design complete, no code written.** The repository contains documentation only: the design
spec, the implementation plan, and the UI handoff bundle. The next action is Task 1 of the plan.

What is settled:

- **Architecture** — light hexagonal in one Python package (`domain/` · `adapters/` · `api/`),
  async-only SQLAlchemy on SQLite, no worker tier. Runs are asyncio-managed subprocesses inside
  the API process.
- **Projects** — a project is a folder, not a repository. Source is *declared* at creation as
  `git`, `local`, or `none`; it swaps the run's terminal step between `pr` and `deliver` and
  nothing else.
- **Memory and artifacts** — consolidated into `<project folder>/.roster/`, tracked by git when
  the project is a repo. Memory is an append-only journal plus a compacted digest, with snapshots
  so a bad compaction is reversible.
- **Frontend** — the SPA shell, primitives, API client, and mock layer are transplanted from an
  existing codebase once, then reworked to the handoff design.

## Status (2026-08-02)

**Implementation plan written** — `superpowers/plans/2026-08-01-roster-setup.md`, 14 tasks and
114 steps covering the repository skeleton through to CI and documentation. Self-review fixed four
defects before commit: an unused test fixture, a method used by tests but missing from an
interface block, a declared-but-unimplemented `RunManager.events()`, and an over-length line. The
plan deliberately excludes `Thread`, `Message`, `McpServer`, `Secret`, and `Attachment`, which
belong to the deferred screen build-out.

## Status (2026-08-01)

**Design spec written and revised three times.** Sequence:

1. **Initial spec** — repository structure, light-hexagonal backend, SQLite, subprocess runs, the
   response envelope, and the UI transplant. Recorded what is deliberately *not* built, so the
   dropped machinery does not creep back.
2. **Made self-contained** — every framing that defined roster by comparison to another project
   was rewritten to stand on its own; the comparison table became a **Non-goals** table. One
   provenance note remains, marking where the UI code is copied from.
3. **Project memory added** (§5) — journal + compacted digest, chosen over a single rewritten
   file because appends are concurrency-safe by construction and compaction becomes a separate,
   retryable step. Memory is written on failed runs too, since a run that failed on an environment
   quirk is often the most valuable thing to remember.
4. **Projects generalised** — projects are no longer assumed to be git repositories. Introduced
   the three declared source kinds and the `deliver` terminal step.
5. **Memory and artifacts consolidated** into `<project folder>/.roster/` after the design pack
   introduced an artifact store, replacing the parallel `~/.roster/projects/<id>/` tree.

**UI design handoff imported** at `design/`, updated to the artifact-store revision. The bundle is
stored as delivered except for a branding pass on `README.md` and the two canvas filenames; the
`.dc.html` internals are byte-identical to the delivered files, so their rendered mockups still
show the original wordmarks.

**Known deviations from the handoff**, all deliberate and recorded in spec §6:

- The Create Project modal drops the `ARTIFACT STORE` block — the location is fixed at
  `<project folder>/.roster/artifacts`, so there is nothing to choose.
- The artifact-store chip in the topbar is informational, not a picker.

## Outstanding (not yet built)

**Everything.** In plan order:

| Plan tasks | Scope |
|---|---|
| 1–3 | Repository skeleton, settings and data root, async engine + ORM + first migration |
| 4–5 | Domain entities and rules; project-folder resolution and `.roster` scaffolding |
| 6–8 | Projects API, work items API, agent-folder reader |
| 9–11 | Memory rules and store, memory API, run manager + fake runtime + SSE |
| 12–14 | UI transplant, project creation wired live, seed + `make dev` + CI + docs |

Deferred beyond the setup plan, each needing its own spec:

- The screen-by-screen build-out — Threads, Agents, Agent Detail, MCP Servers, board, dashboard,
  work-item detail tabs
- `Thread`, `Message`, `McpServer`, `Secret`, and `Attachment` persistence and endpoints
- `SubprocessRuntime` — the real agent runtime and the lead-agent coordination protocol
- Cloning a remote git source into the project folder
- The memory UI — reading, hand-editing, and reverting a digest
- Tuning compaction prompt quality and the digest budget against real project history
- Secrets encryption at rest
- Electron packaging
