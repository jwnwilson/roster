# Roster — Project History & Status

> **Read this first.** What exists, what is designed-only, what comes next — and the working
> practices this project has already paid to learn. Keep **Current state** and **Outstanding**
> accurate; add to **Learnings** only when something cost real time.

## What roster is

A single-user, local-only agent manager with a Linear-style project management UI. The operator
sets up agents on their own machine and coordinates them through a lead agent, driving work from a
board of projects → epics → features → tasks. Agents run as local subprocesses, read a per-project
compressed memory, and leave output in the project's own `.roster/artifacts` folder. A project is
any body of work — a git repository, a plain folder, or no code at all.

Deliberately not a distributed service: one machine, one person, no tenancy, no auth, no broker,
no containers.

- Conventions and layering: [../AGENTS.md](../AGENTS.md)
- Design spec (the authority): [specs/2026-08-01-roster-design.md](specs/2026-08-01-roster-design.md)
- Runtime spec: [specs/2026-08-10-subprocess-runtime.md](specs/2026-08-10-subprocess-runtime.md)
- Backend plan: [superpowers/plans/2026-08-01-roster-setup.md](superpowers/plans/2026-08-01-roster-setup.md)
- UI plan: [superpowers/plans/2026-08-02-roster-ui.md](superpowers/plans/2026-08-02-roster-ui.md)
- UI design handoff: [design/README.md](design/README.md)

## Current state (2026-08-15)

**Backend, UI and the real agent runtime are all merged.** Backend: **344 tests, ~94% coverage**
against an 80% gate (PR #2, then #4). UI: **232 tests**, every screen in the design built (PR #3).
`make dev` boots both; CI runs a job for each on every pull request.

Agents now genuinely run: `SubprocessRuntime` spawns a real CLI, and a full turn has been carried
out end to end against the installed `claude` binary. `FakeRuntime` remains the default so tests and
`make dev` are unchanged.

Architecture is four layers in one package:

| Layer | Holds |
|---|---|
| `domain/` | roster's rules and entities. No I/O; imports adapter **port protocols** only |
| `adapters/` | infrastructure and the ports it implements — `storage/`, `db/`, `agents/` |
| `interactors/` | entry points and orchestration — `api/`, `cli/`, `turns/` |
| `config/` | settings, importable by any layer except domain |

The layer test, written into `AGENTS.md`: *would this make sense in a different product?* → adapter.
*Does it encode how roster works?* → domain. *Is it how the outside world gets in?* → interactor.

Shipping: projects with three declared source kinds each scaffolding `<project>/.roster/`; work
items with hierarchy, `ROS-<n>` keys, and transition validation; agents read from disk with a
broken folder degrading to Disabled-with-reason rather than breaking the listing; project memory as
an append-only journal plus compacted digest with snapshots; threads as the unit of agent work,
with agent turns as asyncio-managed tasks writing messages, SSE streaming, and a memory write on
resolution; a runtime that spawns the agent's own CLI as a real process group; storage behind a
rooted `FileStore` port; database behind a Repository + UnitOfWork.

**Complete:** 13 tasks, a final whole-branch review, two fix waves closing all 13 of its findings,
and a port of the API wiring to match the reference implementation exactly — `get_uow` owns the
request transaction, the session factory is built in `create_app` and published on `app.state`, and
tests inject through the constructor rather than overriding dependencies.

Layering is now **mechanically enforced** by `tests/test_layering.py`, whose guards were each
mutation-checked: the violation injected, the matching test confirmed failing, the tree restored.

## Status (2026-08-02) — runs removed from the code

The design decision below is now implemented, in eight tasks on `feat/ui`. `Run`, `RunEvent`,
`RunManager`, the run routes and the two tables are gone; `Thread`, `Message`, `AgentTurnManager`
and `WorkItem.agent_name` replace them. Migrations 0004–0006. Verified end to end against a running
API: posting a message that names an agent produces its messages, resolving the thread writes a
thread-keyed journal entry to disk, and both run endpoints 404.

**What the implementation changed about the design.** Three things only became visible in the code:

- **The memory step left `start()`.** The plan assumed the turn manager would keep `RunManager`'s
  `finally` block. It could not: resolution is the trigger, and a thread may run many turns before
  the operator resolves it. `write_memory` and `compact_now` stayed on the manager but are called
  from the resolution path.
- **The lifespan reconciliation was deleted rather than ported.** It existed only because a run
  persisted a status a crash could leave non-terminal. A turn persists nothing, so there is no
  orphaned row to find.
- **`status_after_message` moved into the domain.** A question from an agent is what puts a thread
  in the operator's queue; that is a rule, not orchestration.

**Two defects the tests caught, both of the kind this project has recorded before.** Computing the
derived thread fields in the route meant an interactor calling `session.execute` directly — caught
by `test_layering.py`, and the same shape as a defect already in the Learnings below. And moving
`POST /projects/{id}/memory/compact` out of `routes/runs.py` silently disarmed its own 503 test: the
test overrode `get_run_manager` while the endpoint had moved to `get_turn_manager`, so a
failing-compaction test began passing against a working runtime. Both were found because the guards
existed, not because anyone was looking.

## Status (2026-08-02) — runs removed from the design; the thread becomes the unit of agent work

Brainstorming the UI surfaced that half the design's "live" screens were not actually backed, and
the decision taken in response was larger than the UI: **roster no longer has a run entity.**
Recorded in spec §3, §4, §5, §6, §10 and decisions 16–18. Implemented in the entry above.

**What changed.** The unit of agent work is now a *turn inside a thread*, and the messages that
turn writes are the only record — no `Run` row, no `RunEvent` table, no run id, no run monitor. A
`Thread` belongs to a project and *optionally* to a work item, and that one nullable
`work_item_id` is what lets the design's three thread surfaces (chat panel, work-item Thread tab,
global Threads screen) share one table, one endpoint set, and one resolution rule.

**Why it was not just a rename.** Threads absorb what runs did because the design had already
decided they should: the handoff deleted the agent-monitor tab in favour of the Thread tab. The
prior-art schema being transplanted models a message as `text | file_write | question | event`, so
a thread can carry tool output and agent questions, not only chat.

**The consequence that drove the design.** Memory's only automatic writer was run completion. It
now hangs off a thread moving to `resolved` — and because resolving an already-resolved thread is
a 409, the journal entry is written exactly once, enforced by a domain rule rather than by care.
**Threads therefore stopped being an optional mocked screen: project memory does not work without
them.**

**Two long-standing gaps closed in passing.** `Agent.status` can finally be `working`, read from
the turn manager's in-memory set — the folder reader only ever emitted `active` or `disabled`, so
the Agents screen, Board ribbon and Dashboard panel had no source. And `WorkItem` gains
`agent_name`, without which the assigned-agent avatar on every row, card and detail header
rendered from nothing.

## Status (2026-08-09) — the UI, built

Fourteen tasks on `feat/ui`. Every screen in the design handoff exists and `make dev` boots the
whole stack.

**The finding that reshaped the work: the transplant was 12% reuse, not the two-thirds the plan
estimated.** The source SPA was welded to a generated schema for a different API — deleting it
broke 42 files and deleting the hooks it typed cascaded to 60. What genuinely transferred was the
primitive set, the icons, the design tokens (already an exact colour match), the envelope client
and three hooks. Every screen was rebuilt. The plan was corrected in place rather than left to
mislead whoever read it next.

**Provenance is keyed by capability, not by screen**, because the boundary runs through screens:
the board's work items and assigned agent are live while the token count on the same card is not.
Six capabilities flipped from unbacked to live when threads merged, which changed task shapes
rather than a table cell — Threads went from the largest fixture to the screen that proves the
stack.

**CI earned its place on its first run.** There was no workflow at all until this branch; PR #2 had
merged on the strength of a local run. The first CI run caught a real defect in the merged threads
code — two tests started background turns that outlived them, so teardown closed the event loop
mid-write. It passed locally every time and failed on CI's slower machine, which is the worst shape
a defect can have. Fixed with `AgentTurnManager.drain()`.

**What is deliberately not claimed:** nothing has been compared against the hi-fi canvas. The polish
pass fixed focus (invisible on 30 of 33 primitives) and reduced-motion, but pixel fidelity against
`Roster Hi-Fi.dc.html` is untouched and recorded under "Needs a human eye" in
`superpowers/plans/ui-polish-findings.md`.

## Status (2026-08-15) — the real runtime, and the end-to-end suite

Eleven commits on `feat/subprocess-runtime`. **An agent has now actually run.** A turn through the
installed `claude` binary answered in a thread, resolving it wrote the journal entry, and a real
compaction folded that entry into the digest. `FakeRuntime` stays the default; `SubprocessRuntime`
is selected by `roster_use_subprocess_runtime`, so tests and `make dev` are unchanged.

**`config.yaml` names a *tool*, roster owns the *command*.** The new `tool` key is a closed enum
(`claude | codex | gemini`), never a command string. An agent folder is operator content, and a
folder that could name an arbitrary command would turn "a broken folder degrades to Disabled" from
a robustness feature into a security boundary it was never designed to be. An unrecognised name
disables the agent with a reason, exactly as a malformed `token_limit` does.

**The spec's wire format was invented, and every field of it was wrong.** It said so — the JSON was
marked as a placeholder — and probing the real binary replaced `{"kind","content"}` with the actual
`{"type":"assistant","message":{"content":[…]}}`. That correction is why `codex` and `gemini` are
recorded as *blocked* rather than deferred: neither binary is installed, so there is nothing to
verify an adapter against, and writing them from guessed formats is the same mistake a second time.

**Two defects that only running it could find.** The turn manager passed the *thread title* to the
agent instead of the message that summoned it, so a real agent asked to reply `pong` answered the
thread's subject — and all ~330 tests passed, because `FakeRuntime` ignores the task string
entirely. Separately, a turn snapshots the thread's status at start and writes it back at the end,
so an operator resolving mid-turn (the UI offers the button throughout) had the thread silently
reopened, which let a **second journal entry** be written for the same work. The rule now lives in
`domain.status_after_turn` and is applied to stored state rather than the snapshot.

**The end-to-end suite exists** and is the first test to boot a real `uvicorn` against real
migrations and a temporary data root, walking spec §12 over HTTP. Everything else in the suite uses
`ASGITransport`, which starts no server and touches no filesystem. It found its own class of bug
immediately: a documentation-only commit failed CI, which cannot be the docs, and was the
resolution race above.

**What is deliberately not claimed:** a browser-level journey still does not exist, so the screens
remain covered by component tests only. And compaction inherits the server's working directory —
the CLI read files there and volunteered a fact present in none of its inputs. Both are recorded in
the spec rather than quietly carried.

## Learnings

Things this project has already paid for. They are here because each cost real time.

**Prefer proven logic over new logic.** Where a reference implementation exists, port it. The
database layer was rebuilt from a pattern already used across several projects — and the brief said
"adapt, do not copy wholesale", which licensed rewriting where porting was wanted. The result
reimplemented the base class's persistence body inside a subclass. *A brief that permits adaptation
should name exactly which adaptations, and forbid the rest.*

**Plan sample code is a starting point, not a proof.** Six defects across four tasks originated in
the plan's own snippets, not the implementations: four crash paths in the agent reader, two
data-loss bugs in the memory store, a 500 where the spec required 422, and a security test that
passed against a completely unhardened implementation. Implementers transcribed faithfully. What
caught these was reviews that probed, and an instruction to audit sample code before trusting it.

**A test that passes for the wrong reason is worse than no test.** A traversal test passed against
an unhardened `restore()` because the attack string never reached it. Under `ON DELETE CASCADE`, a
404 test kept passing while silently ceasing to cover the branch it named. *For any security or
failure-path test, break the implementation deliberately and confirm the test notices.*

**The spec beats the plan, and writing that down settled four disputes** without a judgement call
each time. When a plan's code contradicts the spec, the code is wrong.

**Reviews can be calibrated too generously.** Duplicated persistence logic was reported as a
"Minor DRY gap" rather than followed through to "then the abstraction is wrong". A route calling a
storage primitive directly was missed entirely and found by the operator on sight. Local untidiness
and structural violations look alike in a diff; the question to ask is what the pattern *should*
be, not whether this line is tidy.

**One agent per worktree, and stop it before replacing it.** An agent reported a connection error;
its worktree was clean with nothing committed, so it was presumed dead and a second agent
dispatched. It resumed. The two overwrote each other. *An error notification is not proof of death
— call `TaskStop` and verify, because a clean tree says nothing about whether a process is alive.*

**Two git rules, learned the same way.** Never `git stash` in a worktree — the stack is shared
across every worktree and other sessions use it. Never `git checkout --` on a file you did not
write: it destroys uncommitted work unrecoverably, where a WIP commit does not. Both belong in
every agent brief; neither was, and both were violated.

**Rescue before deciding.** When that collision was found, the first action was exporting every
uncommitted change to patch files. One had already been discarded by another agent and was believed
unrecoverable — it was in the patch. *Capture first, diagnose second.*

**Push on commit, not on approval.** Work was held back from the PR until each review cleared, so
the operator went looking for a completed refactor and could not find it. Reviewing is not a reason
to hide work.

**Final whole-branch review earns its cost.** Twelve task reviews all passed while two plan
deliverables — the seed CLI and `make dev` — were never implemented by anyone, and no task-scoped
review could have seen it: every task correctly reported its own brief satisfied.

**A fake absorbs wrong arguments silently.** `FakeRuntime` ignores the task string, so passing the
thread title instead of the summoning message changed nothing any test could see — ~330 of them
passed while a real agent answered the wrong question entirely. *A test double that ignores an
argument cannot testify about that argument.* The same shape as the security test that passed
against an unhardened implementation, one layer further out.

**Verify the tool, do not describe it.** The spec's stream format was written from plausibility and
was wrong in every field. Ten minutes probing the installed binary replaced it with fact. *When a
spec must describe something external, mark the unverified parts as unverified* — that marking is
what stopped the implementation inheriting the invention as truth.

**Mutation-check the guard, and check that the mutation applied.** A mutation that appeared uncaught
turned out to be masked by a second, redundant guard; another "restore" silently failed and left the
source mutated, and a `git checkout --` meant to revert a mutation reverted the fix beside it.
*Assert the file actually changed before trusting a green run, and never restore with a command that
can take more than it was aimed at.*

**A docs-only commit failing CI is information, not noise.** Documentation cannot break code, so a
red run on a docs commit is proof of a pre-existing race rather than a bad edit. Chasing it that way
round found a product bug — a finishing turn undoing an operator's resolution — where a rerun would
have hidden it.

**Green tests prove values move, not that they are the right values.** Said three ways this project
now: the traversal test, the fake that ignored its argument, and an `assert task.cancelled()` that
was true of any cancelled task and said nothing about the subprocess its name promised to check.

## Outstanding

**Backend, UI and the real runtime are all merged.** `main` carries 382 backend tests and 232 UI
tests, with CI running a job for each on every pull request. What follows is what has never been
built.

**1. The `gemini` adapter — blocked, not merely unstarted.** `claude` and `codex` both run, each
verified against its real binary. `gemini` is named in the enum and has no adapter. The binary is
not installed on this machine, so there is nothing to verify against, and the one thing that must
not happen is writing it from a guessed output format — that is exactly the mistake the `claude`
mapping already made and had to correct. Needs the CLI installed so the probes in the runtime spec
§4 can be run first.

**2. Compaction inherits the server's working directory.** Found by running it: the CLI read files
in whatever directory the server was started from and folded a fact into the digest that appeared
in none of its inputs. For a *project's* memory that is at best the wrong project's context.
`summarise` never receives the project folder — `compact_now(folder, agent)` has it and does not
pass it on. Fixing it means widening `AgentRuntime.summarise` or running compaction with a neutral
cwd and no tool access; it changes a port `FakeRuntime` also implements, so it wants its own change.

**3. Lead-agent coordination and remote-git cloning.** Both were carried by the runtime item and
neither shipped with it. Spec §3 says the lead spawns and messages other agents through the turn
manager; what it *sends*, and how a sub-agent's output returns to the lead's thread, is undesigned
and must not be inferred from the runtime spec.

**4. A browser-level end-to-end journey.** The API-level journey now boots a real server against
real migrations and walks spec §12 over HTTP, so the API, database and filesystem are proven to
agree. The browser half is not: the screens are still covered by component tests only, which cannot
see whether anything mounts them. Blocked on the same Playwright bridge as the design comparison.

**5. The rendered design comparison.** Every canvas value is now tokenised and the four missing
regions are built, but no screen has been seen rendered against `Roster Hi-Fi.dc.html`. Which token
each component reaches for is unverified. Needs the Playwright MCP browser bridge installed, or a
person with the canvas open. See `superpowers/plans/ui-design-gaps.md`.

**6. Un-mocking the fixture screens.** `McpServer`, `Secret` and `Attachment` persistence, plus any
token or spend figure — no entity carries one, so most of the Dashboard is invented. Each is a
backend slice paired with deleting one file from `projects/ui/src/mocks/unbacked/`; the capability
registry test then forces the registry to follow.

**7. Agent write endpoints** — rename, edit `AGENT.md`, change the model. The controls exist and are
deliberately disabled with their reason on screen.

**8. The memory UI** — reading, hand-editing and reverting a digest. No screen exists in the design
bundle yet, so this needs design before code.

**9. Electron packaging — one of three PRs merged.** The desktop app has a design spec
([2026-08-15](specs/2026-08-15-electron-desktop-design.md)) and a plan
([2026-08-15](superpowers/plans/2026-08-15-electron-desktop.md)) covering all three. What landed is
the server-side precondition: the API now lives under `/api` in dev and packaged alike, because the
UI's own router claims the same root paths it used to serve; and the server can serve the built UI
at `/` when given `ui_dir`, through the `create_desktop_app` entry point. What has not been built is
the Electron shell itself (PR 2 — process supervision, login-shell `PATH` resolution, the graceful
shutdown that keeps agent CLIs from being orphaned) and the `.dmg` build (PR 3 — a relocatable `uv`
venv over python-build-standalone, electron-builder, `make desktop-smoke`, CI).

Three things about the merged half a reader should know before building on it:

- With `ui_dir` set, a non-GET request to an unmatched path returns **405 rather than 404**. The
  single-page-app catch-all registers a GET route at every path, so the method mismatch preempts the
  404. The body is still roster's JSON envelope, so an `/api` miss never returns HTML — the property
  that matters is intact.
- `mount_ui` **must stay registered last** in `create_app`. Its catch-all otherwise shadows every
  real API route, and the whole test suite passed while it did. A test now covers it, verified by
  deleting the ordering and watching that test fail.
- **No browser has rendered the UI from the server.** Every manual check was `curl`. This is the same
  gap as items 4 and 5, and a browser smoke test is scoped into PR 3.

**Further out:** secrets encryption at rest; tuning compaction prompt quality against real project
history.

**Confirm with the designer:** `#2563eb` appears once in the hi-fi canvas and nowhere in its README.
It is treated as a stray browser default and deliberately left untokenised.

**Optional, not planned:** the UnitOfWork could be split into a generic base plus a thin app subclass holding only the repository properties, mirroring the reference's `naaf_db` / `adapters/database` layering. Roster collapsed the two into one class because it has no `libs/` workspace package — the split is still possible without one (a base module beside it), but with a single consumer it buys structure rather than reuse. Worth doing if the generic half is ever shared.

**Known open items:** `next_sequence()` numbers `ROS-<n>` globally rather than per project;
`page_size=0` is an undocumented "unbounded" sentinel; `next_sequence` + insert are not atomic
under concurrent creates; coverage under-reports every line after the first `await` in an async
route, so the percentage is not trustworthy. **Parked with rulings:** a hardlink inside
`snapshots/` bypasses store containment, and a symlink from `snapshots/` into `journal/` resolves —
both need local filesystem write access that already implies direct edit of `MEMORY.md`.
