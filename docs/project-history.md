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

**Backend complete and on PR #1; no UI yet.** Branches: `feat/setup` (backend), `feat/ui`
(not started). **149 tests, 91.2% coverage** against an 80% gate.

Architecture is four layers in one package:

| Layer | Holds |
|---|---|
| `domain/` | roster's rules and entities. No I/O; imports adapter **port protocols** only |
| `adapters/` | infrastructure and the ports it implements — `storage/`, `db/`, `agents/` |
| `interactors/` | entry points and orchestration — `api/`, `cli/`, `runs/` |
| `config/` | settings, importable by any layer except domain |

The layer test, written into `AGENTS.md`: *would this make sense in a different product?* → adapter.
*Does it encode how roster works?* → domain. *Is it how the outside world gets in?* → interactor.

Shipping: projects with three declared source kinds each scaffolding `<project>/.roster/`; work
items with hierarchy, `ROS-<n>` keys, and transition validation; agents read from disk with a
broken folder degrading to Disabled-with-reason rather than breaking the listing; project memory as
an append-only journal plus compacted digest with snapshots; runs as asyncio-managed subprocesses
with SSE streaming and a post-run memory write; storage behind a rooted `FileStore` port; database
behind a Repository + UnitOfWork.

**In flight:** a fix wave closing the final whole-branch review's findings — three Critical (no seed
CLI and a broken `make install`; startup run-reconciliation missing, which lets an orphaned run's
SSE stream poll forever; project folders outside `$HOME` rejected with a false error), eight
Important, plus two abstraction breaks the operator caught by reading the diff.

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

**Backend:** the fix wave above, then merge.

**UI:** all 14 tasks — transplant, tokens, shell, the live/mocked registry, then screens. Half the
designed screens have no backend, so they will be built against mocks with a `DATA_SOURCES`
registry, segregated handler directories, a test asserting the two agree, and a dev-only badge.

**Deferred, each needing its own spec:** `Thread`, `Message`, `McpServer`, `Secret`, `Attachment`
persistence; agent write endpoints; `SubprocessRuntime` and lead-agent coordination; cloning a
remote git source; the memory UI; an end-to-end suite and its CI workflow; secrets encryption at
rest; Electron packaging.

**Optional, not planned:** the UnitOfWork could be split into a generic base plus a thin app subclass holding only the repository properties, mirroring the reference's `naaf_db` / `adapters/database` layering. Roster collapsed the two into one class because it has no `libs/` workspace package — the split is still possible without one (a base module beside it), but with a single consumer it buys structure rather than reuse. Worth doing if the generic half is ever shared.

**Known open items:** `next_sequence()` numbers `ROS-<n>` globally rather than per project;
`page_size=0` is an undocumented "unbounded" sentinel; `next_sequence` + insert are not atomic
under concurrent creates; coverage under-reports every line after the first `await` in an async
route, so the percentage is not trustworthy. **Parked with rulings:** a hardlink inside
`snapshots/` bypasses store containment, and a symlink from `snapshots/` into `journal/` resolves —
both need local filesystem write access that already implies direct edit of `MEMORY.md`.
