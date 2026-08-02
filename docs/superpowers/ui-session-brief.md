# Session brief: roster UI — resuming at Task 2

Paste this into a fresh session to continue the UI build. It replaces the original brief, which
predated the threads work and is no longer accurate.

---

I want to continue building roster's frontend. **Task 1 is done; start at Task 2.**

## Read these first, in this order

1. `AGENTS.md` — conventions, layering, and the rule that the spec wins over any plan
2. `docs/project-history.md` — what ships today
3. `docs/superpowers/plans/2026-08-02-roster-ui.md` — **the plan. Follow it task by task.** It has
   been corrected twice against reality; trust it over anything you remember
4. `docs/design/README.md` — the design handoff: exact tokens, dimensions, per-screen specs. The
   hi-fi canvas beside it (`Roster Hi-Fi.dc.html`) is the visual authority
5. `docs/specs/2026-08-01-roster-design.md` §6 — the frontend section

## Where the work happens

Worktree `.claude/worktrees/roster-ui`, branch `feat/ui`, three commits ahead of `main` and not
pushed. Work lands as a **pull request** — `main` advances only by merge (AGENTS.md).

## State

**Backend: complete and merged.** 310 tests, 95% coverage. Runs were removed and replaced by
threads (spec decisions 16–18, PR #2). Live endpoints:

- `GET/POST /projects`, `GET/DELETE /projects/{id}`
- `GET /work-items?project_id=` (**project_id is required**), `POST /work-items`,
  `PATCH /work-items/{id}`
- `GET /agents` — `status` is `working` while that agent has an in-flight turn
- `GET/POST /threads`, `GET/PATCH /threads/{id}`, `GET/POST /threads/{id}/messages`,
  `POST /threads/mark-all-read`, `GET /threads/{id}/stream` (SSE)
- `GET /projects/{id}/memory` and friends

**UI: Task 1 done.** `projects/ui` installs, lints and tests clean — 60 tests, 24 files.

Run it: `cd projects/ui && pnpm test`. Backend: `make dev` (API only, port 8000).

## The thing to understand before you start

**The harvest was far smaller than planned — 12%, not two-thirds.** The source SPA was welded to a
generated schema for a different API; deleting it cascaded to 60 files. What survived:

- `components/ui/` — 19 primitives, 16 icons
- `lib/theme/tokens.css` — already an exact match for the handoff's colours
- `lib/api/client.ts` — roster's envelope exactly, including the 204 case
- `lib/hooks/` — `useEventSource`, `useLocalStorage`, `useResizableWidth`
- build config; the Vite proxy already strips `/api` (the backend mounts at root)

What did not: every module, `components/thread/`, `Sidebar`, `ChatPanel`, all 24 API hooks.
**Tasks 4–12 are builds, not reworks.** The deleted files are still readable at
`../naaf/projects/ui` — use them as reference for structure, never as a starting point.

`src/app/routes.tsx` names every real destination with a visible "not built yet" placeholder.
Replacing those placeholders is the shape of the remaining work.

## Non-negotiable constraints

- The spec wins over the plan. If they disagree, stop and flag it.
- TDD: failing test first, then implementation.
- `pnpm lint` (eslint + `tsc --noEmit`) and `pnpm test` green before every commit.
- TypeScript strict — no `any`, no `@ts-ignore`.
- Types mirror the API: **`snake_case`**, no camel-casing layer.
- Design tokens live in the Tailwind theme; a hardcoded hex in a component is a defect.
- Every screen handles loading, empty, and error states.
- **No run vocabulary anywhere** — no run entity, route, hook, type, or monitor. Agent output is
  read in the Thread tab.
- Commit format `<type>: <description>`, no attribution trailers.

## Two things worth deciding early

**There is no CI.** No `.github/workflows` at all — PR #2 merged with nothing running
automatically. Plan Task 14 creates both a backend and a UI job. There is a good case for doing it
first, out of order, so nothing else merges unchecked.

**Screen order.** The plan builds Board first. With 12% reuse, building Board and Threads properly
against live data before the mocked screens would prove the whole stack sooner — Threads is now
fully live, including SSE, and project memory depends on it.

## What is still genuinely unbacked

`tokens.usage` (no entity carries a token, spend or progress field — this is most of the
Dashboard), `mcp.*`, `secrets.list`, `attachments.*`, `agents.write`, `workItems.readOne`
(no `GET /work-items/{id}`), `projects.itemCount`. The capability registry in plan Task 3 is how
this stays honest — provenance is keyed by capability, not by screen, because the boundary runs
*through* screens.
