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
- Backend plan: [superpowers/plans/2026-08-01-roster-setup.md](superpowers/plans/2026-08-01-roster-setup.md)
- UI plan: [superpowers/plans/2026-08-02-roster-ui.md](superpowers/plans/2026-08-02-roster-ui.md)
- UI design handoff: [design/README.md](design/README.md)

## Current state (2026-08-02)

**Backend complete; runs replaced by threads; no UI yet.** **310 tests, 95.14% coverage** (branch
measurement on) against an 80% gate. The threads work is on `feat/threads` and has not been merged
— `main` still has the run subsystem until it does.

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
with agent turns as asyncio-managed subprocesses writing messages, SSE streaming, and a memory
write on resolution; storage behind a rooted `FileStore` port; database behind a Repository +
UnitOfWork.

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

## Outstanding

**Backend:** review and merge the `feat/threads` PR. It carries the spec revision, both plans, and
the eight implementation commits. The UI plan rides along because it was written on the same branch before the
split and belongs on `main` regardless — but no UI *code* is on it.

**UI:** all 14 tasks — harvest, tokens, shell, the capability registry, then screens. Branch off
`main` once `feat/threads` lands, rather than reusing the old branch, so the UI starts from a tree
that already has threads in it. Provenance is
keyed by capability rather than screen, because the live/mocked boundary runs *through* screens: the
board's work items are live while the assigned-agent avatar and token count on the same card are
not. Threads, `workItems.assignedAgent` and `agents.workingStatus` are now backed and can come out
of `src/mocks/unbacked/` as the screens are built.

**Deferred, each needing its own spec:** `McpServer`, `Secret`, `Attachment` persistence; any token
or spend figure, which no entity carries; agent write endpoints; `SubprocessRuntime` and lead-agent coordination; cloning a
remote git source; the memory UI; an end-to-end suite and its CI workflow; secrets encryption at
rest; Electron packaging.

**Optional, not planned:** the UnitOfWork could be split into a generic base plus a thin app subclass holding only the repository properties, mirroring the reference's `naaf_db` / `adapters/database` layering. Roster collapsed the two into one class because it has no `libs/` workspace package — the split is still possible without one (a base module beside it), but with a single consumer it buys structure rather than reuse. Worth doing if the generic half is ever shared.

**Known open items:** `next_sequence()` numbers `ROS-<n>` globally rather than per project;
`page_size=0` is an undocumented "unbounded" sentinel; `next_sequence` + insert are not atomic
under concurrent creates; coverage under-reports every line after the first `await` in an async
route, so the percentage is not trustworthy. **Parked with rulings:** a hardlink inside
`snapshots/` bypasses store containment, and a symlink from `snapshots/` into `journal/` resolves —
both need local filesystem write access that already implies direct edit of `MEMORY.md`.
