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

**Backend, UI and the real agent runtime are all merged.** Backend: **382 tests, ~93% coverage**
against an 80% gate (PRs #2, #4, #6, #7, #8). UI: **236 tests**, every screen in the design built
(PRs #3, #7). `make dev` boots both; CI runs a job for each on every pull request.

Agents genuinely run. `SubprocessRuntime` spawns the agent's own CLI as a real process group, and
full turns have been carried out end to end against the installed `claude` **and `codex`** binaries
— answering in a thread, writing files, and folding a resolved thread into the project digest.
`FakeRuntime` remains the default, selected off unless `roster_use_subprocess_runtime` is set, so
tests and `make dev` are unchanged.

The API is served under `/api`, with the built UI served from the same process at root (PR #8).

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
(`claude | codex | antigravity`), never a command string. An agent folder is operator content, and a
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

## Status (2026-08-15) — a second CLI, and the screen that lied about it

Both remaining CLIs were installed. `codex` authenticated, so its adapter is built and merged
(PR #6); `gemini` did not, so it is not (Outstanding 1). *(Gemini was replaced in the enum by
**antigravity** — binary `ayg` — on 2026-08-16; the rest of this entry is left as it was written.)* Two further merges followed from what
running codex exposed.

**codex shares no field with claude.** claude nests content blocks inside an `assistant` message;
codex emits flat lifecycle events — `thread.started`, `turn.started`, `item.started`,
`item.completed`, `turn.completed` — and carries the work in `item`. Every shape in its tests was
captured from the binary rather than composed from documentation. This is the clearest evidence
that one thin adapter per tool was the right boundary.

**Three defects only a second real tool could find.** Each was latent in merged, green code:

- **Every turn was handed the server's stdin.** `execute` set stdout and stderr and left stdin
  inherited from uvicorn. codex reads stdin when it is there, so the first live turn died with
  "Reading additional input from stdin..." *before the agent saw the task*. claude ignores stdin,
  which is the only reason it survived the first adapter.
- **`parse` could return one message per line** — already losing data in the shipped claude
  adapter, which returned at the first content block, so a message that explained an edit and then
  made it showed only the explanation. codex made it unavoidable: an `apply_patch` over three files
  is one event carrying three paths.
- **The Agents screen announced the wrong vendor.** `Agent.model` fell back to a *claude* model, so
  an agent whose `config.yaml` is only `tool: codex` reported `claude-opus-5` — under a column
  headed "MODEL · config.yaml", from a file that never said it — and nothing on screen named the
  tool at all. Found by opening the running app (PR #7). `model` is now `None` when nobody chose
  one, and both agent screens name the tool.

**`--model` is passed to codex only when the operator chose one.** Forcing it overrides codex's
account-aware default: `--model gpt-5-codex` failed with "not supported when using Codex with a
ChatGPT account" on an account where omitting it worked.

Separately, PR #8 moved the API under `/api` and serves the built UI from the server, which is what
lets the desktop packaging work bundle one process instead of two.

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

**A green suite says nothing about the case its fixtures never describe.** The Agents screen
asserted the wrong vendor for a codex agent while 232 UI tests passed, because every fixture was a
claude agent with an explicit model. The bug was found by opening the app. *When a field gains a
second possible shape, the fixtures are the first thing that must learn it* — and `tsc` then caught
two tests that had been passing a now-nullable value as a matcher, so the suite was green while the
type was wrong.

**A defaulted value is a claim, and a claim can be false.** `Agent.model` defaulted to a real model
name rather than to nothing, so "the operator did not choose" and "the operator chose claude-opus-5"
became indistinguishable. The adapters had to compare against the default value to recover the
distinction the type had thrown away. *Prefer a type that can say "unset" over a default that
pretends otherwise.*

**Green tests prove values move, not that they are the right values.** Said three ways this project
now: the traversal test, the fake that ignored its argument, and an `assert task.cancelled()` that
was true of any cancelled task and said nothing about the subprocess its name promised to check.

**A plan's file path is a claim until you run it.** The desktop plan's own `package.json` snippet
pointed the Electron entry point at `dist-main/main.js`; `tsc` with `rootDir: src` actually emits
`dist-main/main/main.js`. The wrong path does not error — Electron finds no entry module,
`whenReady` never fires, and the process just hangs with no output. It cost a bisection to find,
and the plan doc was corrected once the real path was known rather than left to mislead the next
reader.

**An export flag can silently drop the one package that matters.** `uv export --frozen --no-dev`
looked right and produced a venv that built clean, because `roster-server` lives only in the root
`pyproject`'s dev dependency-group and never in `[project].dependencies` — a bare `--no-dev` export
therefore yields an *empty* requirements file and a payload that cannot import the app. The fix is
`--package roster-server` plus a `test -s` assertion on the export before trusting it. A clean
build cannot reveal this class of bug on its own; only running the result can.

**A guard that lives in one caller is not a guard.** The first fix for a packaged build shipping
mock data was `VITE_USE_MOCKS=false` on the `make desktop` command line. An ordinary `pnpm build`
in `projects/ui` — no flag — put the mock-service-worker chunk straight back in, and a packaged app
that looked like a working board never sent a single request to uvicorn; it rendered fixtures
forever against `~/.roster` it never touched. Moving the pin into `projects/ui/.env.production`,
which Vite loads for every production build regardless of who invokes it, is what actually closed
the gap. `make desktop-smoke` now also greps the built bundle for `setupWorker`/`mockServiceWorker`
so the check survives the next caller nobody thought of.

## Outstanding

**Backend, UI, the real runtime and two of its three adapters are merged.** `main` carries 382
backend tests and 236 UI tests, with CI running a job for each on every pull request. What follows
is what has never been built.

**1. The `antigravity` adapter — blocked, and the binary is not here.** `claude` and `codex` both
run, each verified against its real binary. The third slot in the enum was gemini until 2026-08-16;
Google's CLI for this is now **antigravity**, which ships as **`ayg`**, so the enum, settings default
and spec were changed to match. Nothing has probed it — `ayg` is not installed on this machine — and
the runtime spec §4 records why writing an adapter from anything less than a probe is the specific
mistake the `claude` mapping already made and had to correct. Install it, probe it, then build the
adapter, in that order.

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

**9. Desktop packaging — merged, with one gap named.** The desktop app has a design spec
([2026-08-15](specs/2026-08-15-electron-desktop-design.md)) and a plan
([2026-08-15](superpowers/plans/2026-08-15-electron-desktop.md)); all three of its PRs are now
merged: the server-side precondition (the API under `/api`, the built UI served at `/` through
`create_desktop_app`), the Electron shell (process supervision, login-shell `PATH` resolution, the
graceful shutdown that keeps agent CLIs from being orphaned), and the `.dmg` build (a relocatable
`uv` venv over python-build-standalone, electron-builder, `make desktop-smoke`, CI). `make desktop`
produces an unsigned arm64 `.dmg`; CI builds the python payload and runs `make desktop-smoke` on a
macOS runner (`macos-14`, since it is the only job that builds a macOS app).

Measured, not estimated: the relocatable python payload is **43 MB** (the design spec's own guess
was 120–180 MB), `Roster.app` unpacked is **282 MB** — mostly Electron's own arm64 framework, not
roster's code — and `Roster-0.1.0-arm64.dmg` is **106.3 MiB**.

What is actually verified: the app boots end to end (login-shell `PATH` resolution, the alembic
migration, the seed, uvicorn on `interactors.api.desktop:create_desktop_app`), `/api/health` returns
200, `GET /` and its JS/CSS return 200 through a live `BrowserWindow`, real backend traffic reaches
the real `~/.roster` (curl returned real project folders, not fixtures), a clean shutdown leaves no
orphaned `uvicorn`, `make desktop-smoke` passes against the built payload, and 34 desktop unit tests
pass.

**The gap, named:** nobody has ever seen the board render on screen. `screencapture` is denied in
this environment, so every check above was logs, curl, or bundle inspection — never a screenshot.
Also never done: starting an agent turn in the packaged app and watching messages stream, and
tearing down a *live* agent CLI subprocess through the shutdown cascade (only the sidecar's own
clean stop was observed, with no turn in flight). `main.ts` is excluded from the desktop coverage
gate for the same reason, which is why it is kept to wiring only.

**Not built:** auto-update, notarization and Developer ID signing, universal or x64 builds, Windows
and Linux targets.

Three more things about the merged server-side half a reader should know before building on it:

- With `ui_dir` set, a non-GET request to an unmatched path returns **405 rather than 404**. The
  single-page-app catch-all registers a GET route at every path, so the method mismatch preempts the
  404. The body is still roster's JSON envelope, so an `/api` miss never returns HTML — the property
  that matters is intact.
- `mount_ui` **must stay registered last** in `create_app`. Its catch-all otherwise shadows every
  real API route, and the whole test suite passed while it did. A test now covers it, verified by
  deleting the ordering and watching that test fail.
- A packaged build shipped MSW fixtures instead of talking to `~/.roster` the first time it was
  built, and the first fix for it was bypassable — see Learnings.

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
