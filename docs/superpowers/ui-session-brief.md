# Session brief: roster UI migration

Paste the contents of this file into a fresh session to start the UI work. It runs in parallel
with the backend — see "Where the work happens" below for the one point of coupling.

---

I want to build the frontend for **roster**, a single-user local-only agent manager. Start with
the `superpowers:brainstorming` skill — I want the design explored properly before any plan is
written, and there are real open questions below.

## Read these first, in this order

1. `AGENTS.md` — conventions, layering, and the rule that the spec wins over any plan
2. `docs/project-history.md` — what ships today and what is designed-only
3. `docs/specs/2026-08-01-roster-design.md` §6 — the frontend section, including three deliberate deviations from the design handoff
4. `docs/design/README.md` — the UI design handoff: exact tokens, layout dimensions, and per-screen specifications. The hi-fi canvas beside it (`Roster Hi-Fi.dc.html`) is the visual authority
5. `docs/superpowers/plans/2026-08-02-roster-ui.md` — **a draft plan I wrote without brainstorming.** Treat it as input, not as settled. If brainstorming produces a better shape, replace it.

## Where the work happens

Worktree `.claude/worktrees/roster-ui` on branch `feat/ui`, branched from the backend branch.

**You can work in parallel with the backend's remaining task.** The backend has one task left — a
layering refactor moving `api/` to `interactors/` — but that changes **Python import paths only**.
The HTTP routes are unchanged, and the UI talks to the backend over HTTP, so nothing you build is
affected by it. The single exception is the `make dev` wiring in the final task, which references
`uvicorn interactors.api.app:create_app` — merge the backend branch before doing that one, and
confirm the factory path against the Makefile rather than assuming it.

To run the backend while developing against live endpoints: `make run` from the backend worktree
at `.claude/worktrees/roster-setup`, which serves on `:8000`. Or develop entirely against mocks,
which is the default and needs no backend at all.

## What already exists

The backend is at 120 tests and ~89% coverage. Live endpoints available to the UI:

- `GET/POST /projects`, `GET /projects/{id}`, `DELETE /projects/{id}`
- `GET/POST /work-items`, `PATCH /work-items/{id}`
- `GET /agents` (read-only — no write endpoints)
- `GET /projects/{id}/memory`, `/memory/journal`, `/memory/snapshots`, `POST /memory/compact`, snapshot restore
- `POST /work-items/{id}/runs`, `GET /runs/{id}`, `/runs/{id}/events`, SSE at `/runs/{id}/events/stream`

Every response uses the envelope `{success, data, error}`, plus `meta` for paginated collections.

## The central problem to think about

**Half the designed screens have no backend.** Threads, MCP servers, attachments, and secrets have
no persistence and are not in any current plan. Screens with a real API: Board, Issues List, Work
Item Detail (Spec and Activity tabs), both create modals, Agents and Agent Detail (reads only),
and parts of the Dashboard.

I have already decided to **build all screens, mocking the ones with no API** — the screens settle
their shape before those APIs get designed. The risk I want the plan to handle is that "it works"
stops meaning anything when half the app is fixtures. The draft plan's answer is a `DATA_SOURCES`
registry, MSW handlers physically split into `live-parity/` and `unbacked/`, a test asserting the
two agree, and a dev-only badge on each screen. **Challenge that if you have a better idea** —
the goal is that nobody can mistake a mocked screen for a working one, and that a screen cannot
quietly stay mocked after its API lands.

I have also decided on **fidelity in two passes**: extract the handoff's tokens into Tailwind
exactly, build screens structurally correct against them, then a later pass for hover/active/focus
states, motion, and empty/loading/error coverage.

## Facts about the transplant, from an actual inventory

The starting point is an existing SPA at `../naaf/projects/ui` — about 8,400 lines of source and
4,000 of tests, 18 design-system primitives, and six modules: `board`, `create`, `dashboard`,
`detail`, `inbox`, `settings`.

Roster's design needs `threads` (a rework of `inbox`), and **`agents` and `mcp`, which have no
equivalent to transplant**. So it is roughly two-thirds reuse, one-third new build. Do not assume
the transplant gives you more than it does.

Deliberate exclusions: the `e2e/` directory and Playwright config are not transplanted, since
end-to-end testing is deferred. Nothing under `projects/ui` may contain the string `naaf`
afterwards.

## Open questions worth brainstorming

These are genuinely unresolved — I have opinions but not decisions:

1. **Screen order.** The draft builds Board first because it is the primary shell. Is there a better
   first screen for learning — one that exercises more of the stack, or de-risks more?
2. **What happens to the inherited code that does not fit.** The draft says delete rather than stub,
   and record deletions in the commit body. Is deletion right, or is there value in keeping some of
   it on a branch?
3. **How the chat panel fits.** It appears on every project screen in the design, but the lead-agent
   conversation it implies has no backend at all. Is it a mocked shell, or deferred entirely?
4. **Agent Detail writes.** The design shows an editable `AGENT.md` and a model picker, but there
   are no write endpoints. The draft says show the control and be explicit that it does not persist,
   rather than faking a successful save. Is there a better answer?
5. **Where the run monitor lives.** The design removed the old agent-monitor tab and says the Thread
   tab carries that information — but Thread is mocked and runs are live. Where does live run
   progress actually surface in the first version?

## Constraints that are not up for negotiation

- The spec wins over any plan. If they disagree, stop and flag it.
- TDD: failing test first, then implementation.
- `pnpm lint` (eslint + `tsc --noEmit`) and `pnpm test` green before every commit.
- TypeScript strict — no `any`, no `@ts-ignore`.
- Design tokens live in the Tailwind theme; a hardcoded hex in a component is a defect.
- Mock-first: the app must run fully with no backend (`VITE_USE_MOCKS=true` by default).
- Every screen handles loading, empty, and error states.
- Commit format `<type>: <description>`, no attribution trailers.

When brainstorming is done and the design is agreed, write the plan with `superpowers:writing-plans`
and then execute it with `superpowers:subagent-driven-development`.
