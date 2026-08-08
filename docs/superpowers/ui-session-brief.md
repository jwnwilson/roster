# Session brief: roster UI — resuming at Task 13

Paste this into a fresh session to continue the UI build. It replaces the original brief, which
predated the threads work and is no longer accurate.

---

I want to continue building roster's frontend.

**Done:** Tasks 1–12 — **every screen in the design now exists**. Plus CI.
**Next:** Task 13 (the polish pass), then the rest of 14 (`make dev` and docs).

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

**UI: 175 tests green, CI running on every push.** What exists:

| Built | Notes |
|---|---|
| Tokens | colours were already exact; type scale, spacing, radii, shadow added; no hardcoded hex remains |
| Capability registry | keyed by capability, not screen; `mocks/live-parity/` vs `mocks/unbacked/`, enforced by test |
| App shell | Sidebar (live projects, git vs folder glyph), ChatPanel (lead-agent threads, collapse persisted), error boundary |
| Board | live work items and assigned agent; five columns always present; loading/empty/error |
| Threads | **fully live** — two tabs, badges from stored status, 409-on-repeat-resolve surfaced, read marked server-side, live SSE with capped backoff |
| Work item detail | Spec (markdown) and Activity tabs; 409 vs 422 distinguished; reads from the project listing since there is no GET /work-items/{id} |
| Agents | list and detail; reads live including `working` from an in-flight turn; every write disabled with its reason |
| Attachments · Secrets | fixtures; upload says it keeps nothing; **secrets have no value field at all**, so there is nothing to leak |
| Work item Thread tab | live, same conversation scoped to the item (handoff §D3) |
| Dashboard | agents panel live; metric cards, token chart and activity are fixtures and badged; panels fail independently |
| MCP | list and detail; **entirely fixtures** — no McpServer persistence — with tool toggles that say plainly they are not saved |
| Create modals | both live; project type without the artifact-store block (spec §6); the work-item hierarchy is unreachable-by-construction rather than left to the API's 400 |

**No placeholder routes remain.** The only unbuilt surfaces are Settings' General / Billing /
Integrations panes, which the handoff specifies as nav items without content.

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

**CI exists now** (`.github/workflows/ci.yml`, backend + UI jobs) and earned its place on the first
run: it caught a real defect in the merged threads work — two tests started background turns that
outlived them, so teardown closed the event loop mid-write. Passed locally every time, failed on
CI's slower machine. Fixed with `AgentTurnManager.drain()`.

**The SSE stream is a signal, not a payload.** The backend names each frame by message kind and
sends the message *content* as `data` — no author, no timestamp — so `useThreadStream` refetches on
a frame rather than reconstructing a Message the server already knows how to build. The harvested
`useEventSource` could not be used directly: it parses `data` as JSON and listens only for unnamed
events, so neither would ever fire against this stream. Its `reconnectDelay` helper is reused.

## What is still genuinely unbacked

`tokens.usage` (no entity carries a token, spend or progress field — this is most of the
Dashboard), `mcp.*`, `secrets.list`, `attachments.*`, `agents.write`, `workItems.readOne`
(no `GET /work-items/{id}`), `projects.itemCount`. The capability registry in plan Task 3 is how
this stays honest — provenance is keyed by capability, not by screen, because the boundary runs
*through* screens.
