# Projects that span several repositories

A plan, not an implementation. Written 2026-09-05, against `main` at
`8281888`.

Answers the TODO line *"Plan for extending agents to work with multi repos and
for the context logic to updated to work per project"*.

## 0. The first thing to correct

The TODO — and the way this is usually described — assumes a project owns a
repository path today and that the work is widening one path into many. **It
does not.** `ProjectStore` (`electron/main/store/projects.ts`) reads and writes
six columns, and none of them is a path — migration 4's table:

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
```

plus `archived_at` from migration 7. `shared/types.ts` says so out loud:

> A named grouping of work. Deliberately just metadata: a project does not own
> a directory or a set of agents, it only labels tasks and sessions.

The directory lives on the **agent**: `Agent.cwd`, persisted as `cwd` in
`~/roster/agents/<id>/agent.toml`, defaulted to `~/roster/workspace` at
`electron/main/ipc/index.ts:305`, and handed to the runner at
`electron/main/sessions/manager.ts:410` as `cwd: agent.cwd`. Sessions have no
directory of their own; a session's working directory is whichever agent it is
open on.

This changes the shape of the task substantially, and mostly for the better:

- There is **no data to migrate**. Nothing on disk or in SQLite currently
  claims "this project lives here", so nothing has to be reinterpreted. The
  compatibility problem is entirely behavioural, and §6 is about that.
- The real work is not "one path becomes many". It is **moving the answer to
  "where does this work happen?" off the agent and onto the project**, and
  only then letting that answer be plural. An agent is a persona — a runner, a
  model, a system prompt. That it also carries a checkout is an accident of
  the original design that multi-repo makes untenable.

## 1. The problem, precisely

Three concrete failures, all of which happen today.

**1. An agent can only ever be in one place.** `Agent.cwd` is a single string
set when the agent is created. A "Backend Agent" pointed at `~/work/api`
cannot touch `~/work/shared-types`, even to read it. The only way to have an
agent work in a second repository is to create a second agent — which
duplicates the system prompt, the skills, the MCP config and the identity, and
splits that agent's session history and spend across two rows in the roster.

**2. Filing work under a project says nothing about where it is.** Two
sessions filed under project "Checkout rewrite" may be running in two
unrelated directories, and Roster neither knows nor says. The project brief
tells the agent what the project *is* and what is *open* on it, but not what
is on disk. An agent asked to "fix the 504 retry" has to guess which checkout
that means, and if the fix crosses a service boundary it cannot see the other
side at all.

**3. The plan-build flow assumes one repository, silently.**
`PlanFlow.approve` (`electron/main/sessions/planFlow.ts:111`) refuses unless
`isGitRepository(agent.cwd)`, and `buildPrompt`
(`electron/main/sessions/planPrompt.ts:95`) names exactly one worktree:

```ts
export function worktreeFor(plan: Plan): string {
  return join(worktreesDir(), branchFor(plan).split('/').slice(1).join('-'))
}
```

There is no repository in that path — the worktree is named after the *plan*
and rooted implicitly at whatever repository the agent happens to be sitting
in. A plan that touches two services has nowhere to say so, and `Plan.prUrl`
is a single optional string, so it could not report the second pull request
even if it made one.

Why now: the board, sessions, notes and the brief have all converged on the
project as the unit of work. The project is the only thing left that does not
know where the work is.

## 2. What is true today, concretely

Verified by reading the code at `8281888`, not inferred.

### 2.1 The single working directory

`Agent.cwd` has exactly one producer and a short list of consumers:

| Site | What it does |
|---|---|
| `electron/main/store/agentToml.ts:142,159` | Reads/writes `cwd` in `agent.toml`, expanding and collapsing `~` |
| `electron/main/store/agents.ts:110,121,161,170` | Persists it and `mkdir -p`s it on create and on update |
| `electron/main/store/agents.ts:229-230` | Projects it to `Agent.cwd` / `Agent.cwdLabel` |
| `electron/main/ipc/index.ts:305` | Defaults a new agent to `~/roster/workspace` |
| `electron/main/sessions/manager.ts:410` | **The only place a turn learns where to run** |
| `electron/main/ipc/index.ts:215` | `PlanFlow`'s `cwdFor` — `agentStore.findById(id)?.cwd ?? null` |
| `src/screens/AgentDetail.tsx:272` | The terminal pane opens a pty there |
| `src/screens/AgentDetail.tsx:466`, `src/screens/AgentsGrid.tsx:162` | Shows `cwdLabel` |
| `src/screens/EditAgentModal.tsx:149-151`, `src/screens/NewAgent.tsx:113-114` | The directory picker |

Downstream of `manager.ts:410`, `StartOptions.cwd`
(`electron/main/runners/types.ts:62`) is a single string, and each runner uses
it once:

- `ClaudeRunner.run` → `options: { cwd: options.cwd, ... }`
  (`electron/main/runners/claude.ts:66`).
- `CodexRunner.run` → `codexPermissionOverrides(options.cwd)`, `-C options.cwd`
  and `{ cwd: options.cwd }` on the spawn
  (`electron/main/runners/codex.ts:82,112,121`).
- `CustomRunner` → `{cwd}` substitution in the argv template and the spawn
  (`electron/main/runners/custom.ts:64,73`).
- `runSubprocess` refuses up front if the directory does not exist
  (`electron/main/runners/subprocess.ts:28`).

One of those is load-bearing for §3.3 and easy to miss —
`electron/main/runners/codex.ts:87-90`:

> `exec resume` has its own option set. Its working directory is inherited
> from the stored session, so it rejects the base `exec` command's `-C`.

**A Codex session is pinned to the directory of its first turn for its whole
life.** Changing `agent.cwd` today already fails to move a running Codex
thread; anything that lets a session's directory change has to reckon with
that.

Nothing in the schema records a directory. `sessions`, `tasks` and `plans`
have no path column; `grep -rn "repoPath\|repo_path"` over `electron/`,
`shared/`, `src/` and `tests/` returns nothing. A session's directory is not
persisted at all — it is re-derived from `agent.cwd` at turn time.

And the default is weak on purpose: `store/defaultAgents.ts:81` seeds all
three first-run agents at `~/roster/workspace`, which is not a checkout, so a
fresh install cannot approve a plan at all until somebody repoints an agent.
`tests/main/planFlow.test.ts:224-234` records that as found the hard way. The
directory is already the thing users have to fix by hand before Roster's most
valuable flow works.

### 2.2 The one multi-directory hook that already exists

`ClaudeRunner` already passes `additionalDirectories`, but only for skills
(`electron/main/runners/claude.ts:93`):

```ts
...(options.skillPaths.length > 0 ? { additionalDirectories: options.skillPaths } : {}),
```

This is the seam multi-repo needs, and it is already load-bearing and tested.

### 2.3 Worktrees

Roster ships **no git code at all**. `electron/main/sessions/repo.ts` says so:

> A filesystem check rather than a call to git: Roster deliberately ships no
> git code, and this only needs to answer whether asking an agent to make a
> worktree here is a reasonable thing to do.

It exports `isGitRepository(dir)` and `gitMetadata(dir)`, which walk **up** for
a `.git` marker and resolve `gitdir:`/`commondir` for linked worktrees. Nothing
else. Because the walk is upward, a directory that *contains* several sibling
checkouts resolves to none of them — or, if the parent happens to be a
repository itself, to the wrong one. "Point the agent at the folder with all
my repos in it" is therefore not a workaround that exists today.

Worktrees therefore exist in exactly one place — **the plan-build prompt**,
which asks the agent in prose to make one:

```
    git worktree add ~/roster/worktrees/plan-3f57bd-fix-retries roster/plan-…
```

and `worktreesDir()` (`electron/main/store/paths.ts:55`) is only a name:

> Roster never creates it — the agent runs `git worktree add` itself.

The one place worktrees are enforced rather than requested is the Codex
sandbox, `codexPermissionOverrides` (`electron/main/runners/codex.ts:144`),
which makes `gitMetadata(cwd).gitDir`, `.commonDir` and `worktreesDir()`
writable under a `roster-worktree` profile. `tests/main/runners.test.ts:127-214`
asserts the exact override strings, so this is the one worktree surface with a
compile-time-ish contract.

So: **"one worktree per task" is not a thing that exists.** What exists is one
worktree per *approved plan*, named after the plan, in a repository nobody
recorded. That is the honest starting point for §7.

### 2.4 The brief, and its budget

`electron/main/sessions/projectBrief.ts` builds a text block from the project
row, its tasks, their non-system comments and its `NOTES.md`.
`SessionManager.withProjectBrief` (`manager.ts:454`) prepends it when
`session.projectId` is set, and `hasAlreadyRead` (`manager.ts:487`) suppresses
a byte-identical brief on a resumed thread so a long session does not pay for
it every turn.

The budget:

```ts
export const PROJECT_BRIEF_BUDGET = 2000
const NOTES_BUDGET_SHARE = 0.5
const COMMENT_EXCERPT_CHARS = 220
```

Four blocks, in order: `Project notes` (capped at half the budget, keeps its
**tail** because `remember` appends), `Open tasks`, `Done`, `Recent comments`.
Each admits what it dropped — `(+N more tasks — use list_tasks)` — and a block
that cannot fit its heading is omitted rather than shown empty.

The header is `PREAMBLE` (115 characters) + `Project: <name>` + the
description. So roughly **7% of the budget is spent before any content**, and
the notes may take up to another 50%.

`~/roster/projects/<id>/NOTES.md` is one file per project, keyed on id not
slug (`electron/main/store/paths.ts:97`), read by `ProjectNotesStore.body()`
which strips the untouched starter block so the model is not charged for
Roster's own words, and written by the `memory` MCP server's `remember` /
`recall` (`manager.ts:906-915`), which is opt-in per agent like `tasks` and
`plans` (`shared/mcp.ts:17-43`).

**The "context logic per project" half of the TODO is therefore already about
80% done** — the 2026-08-28 project-memory spec built it. What is missing for
multi-repo is one block and one budget decision, not a rewrite. §5.

## 3. Design: a project owns its repositories

### 3.1 Data model

Migration **12** (the last is 11, `sessions.name`):

```sql
CREATE TABLE project_repos (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  -- What to call it in the brief and the picker. Defaults to basename(path).
  name        TEXT NOT NULL,
  -- One line: what this repository is, for the brief. May be empty.
  description TEXT NOT NULL DEFAULT '',
  -- Ordering, and position 0 is the primary. See §3.2.
  position    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE UNIQUE INDEX ux_project_repos ON project_repos (project_id, path);
CREATE INDEX ix_project_repos_project ON project_repos (project_id, position);
```

`ON DELETE CASCADE`, unlike `tasks.project_id`'s `SET NULL`: a repository row
is a statement *about* a project and means nothing without it — deleting the
project does not delete the checkout, only Roster's note of it.

A child table rather than a JSON column on `projects`, for the same reason
`task_comments` is a table: ordering, uniqueness and a foreign key are all
things SQLite should enforce rather than a `JSON.parse` in the store.

```ts
export interface ProjectRepo {
  id: string
  projectId: string
  path: string
  /** path with the home directory collapsed to ~, for display. */
  pathLabel: string
  name: string
  description: string
  position: number
  /**
   * Derived, not persisted: whether `path` still looks like a git checkout.
   * A repository that has been moved or deleted is shown, not hidden —
   * silently dropping it would read as "this project has one repo".
   */
  exists: boolean
  isRepository: boolean
}
```

`Project` itself is unchanged. A new `ProjectRepoStore` in
`electron/main/store/projectRepos.ts` (`listByProject`, `add`, `update`,
`remove`, `reorder`) sits beside `ProjectStore` rather than inside it, keeping
both under the 200–400 line house norm.

### 3.2 The primary repository

Position 0. It is the one a turn's `cwd` resolves to, the one the terminal
opens in, and the one a plan branches from. Every other repository is
*reachable* but not *the* place.

A designated primary rather than a flat set, because every downstream
interface takes exactly one directory: `child_process.spawn` needs a `cwd`,
node-pty needs a `cwd`, `git worktree add` needs a repository to be run from.
A "no primary" design would push that choice into every call site instead of
making it once.

### 3.3 Resolving a session's working directory

One new pure function, `electron/main/sessions/workspace.ts`, so this is
testable without a runner — the same shape as `resolveSessionProject`
(`electron/main/sessions/defaultProject.ts`), which already exists to answer
the analogous question for projects:

```ts
export interface Workspace {
  /** The turn's cwd, and where the terminal opens. */
  root: string
  /** Every other repository on the project, for additionalDirectories. */
  additional: readonly string[]
  /** Why it resolved this way, for the config rail. */
  source: 'session' | 'project' | 'agent'
}

export function resolveWorkspace(input: {
  agent: Agent
  session: Session
  repos: readonly ProjectRepo[]
}): Workspace
```

Order:

1. **The session's own pin.** A new nullable `sessions.repo_id`, set from the
   config rail, wins. This is how a user says "this session is the one working
   in `shared-types`".
2. **The project's primary**, when the session is filed and the project has
   repositories.
3. **`agent.cwd`** — today's behaviour, unchanged, and the answer for every
   unfiled session and every project nobody has added a repository to.

`SessionManager.send` then becomes:

```ts
const workspace = resolveWorkspace({ agent, session, repos: this.reposFor(session) })
const stream = runner.run(this.withProjectBrief(session, prompt), {
  cwd: workspace.root,
  additionalRoots: workspace.additional,
  ...
})
```

`StartOptions` gains `additionalRoots: readonly string[]` (defaulting to
empty), and each runner does what it can with it:

- **Claude** — appended to the existing `additionalDirectories` alongside
  `skillPaths`. This is a one-line change to `claude.ts:93` and the capability
  is real: the SDK already grants read/write there.
- **Codex** — `codexPermissionOverrides` changes signature from
  `(cwd: string, worktreeRoot?)` to `(roots: readonly string[], worktreeRoot?)`
  and unions `gitMetadata()` over all of them. `tests/main/runners.test.ts`
  needs updating; the assertion style is already list-based so this is a small
  diff. The `cwd` passed to `spawn` stays `workspace.root`, and Codex's
  `:workspace` profile is *widened* by the extra roots, not replaced.
- **Custom** — `{cwd}` continues to be `workspace.root` and additional roots
  are **ignored**. Stated plainly rather than faked: a custom runner is an
  argv template Roster does not understand, and there is no honest way to tell
  it about a second directory. The UI should say so where a custom-runner
  agent is used on a multi-repo project.

### 3.4 A session's workspace is decided once

`resolveWorkspace` must be evaluated **when a session's runner thread is
opened, not on every turn**, and the answer stored on the session row.

This is forced by `codex.ts:87-90`: `exec resume` inherits its directory from
the stored Codex session and refuses `-C`, so a resumed Codex turn silently
runs somewhere other than where `workspace.root` now says. Re-resolving every
turn would make Claude and Codex disagree about what the same setting means —
under Claude the session moves, under Codex it appears to and does not.

So `sessions.repo_id` is written when the session is created and, if the user
changes it, the change applies only while `session.runnerSessionId === undefined`.
Once a thread exists, the picker is disabled with `The working directory is
fixed once a session has started — open a new session to work elsewhere.`

This is a smaller restriction than it sounds: a session is already the unit
that carries one thread of work, and `additionalRoots` — the multi-repo part —
is not affected, because it goes through `--config` overrides that
`exec resume` does accept and through `additionalDirectories`, which the
Claude SDK re-reads each call.

## 4. What happens to `Agent.cwd`

It stays, and it keeps its meaning: *where this agent works when nothing else
says*. Removing it would break every unfiled session, the terminal on an
unfiled session, and every existing install on first launch.

But it stops being the primary answer, and the UI should say so — the
AgentDetail row currently labelled `Directory` becomes `Default directory`,
and the session config rail grows a `Working in` row showing
`workspace.root`'s label and, where the project has more than one repository,
a picker over them writing `sessions.repo_id`.

This is the one place I would push back on doing more. A tempting next step is
to delete `Agent.cwd` entirely and require every session to be filed under a
project. It is cleaner, and it is a much larger product change — it makes
"unfiled session" impossible, which is currently the default state of every
session Roster opens. **Recommendation: keep `Agent.cwd`.** See open question
§10.2.

## 5. Context and the brief when a project spans repositories

### 5.1 The missing block

The brief never mentions the disk. The smallest change that makes multi-repo
usable at all is a `Repositories` block, and it belongs at the **top**, above
the notes: an agent that reads "the retry logic is in the gateway, not the
API" in the notes needs to already know what "the gateway" is a name for.

```
Project context from Roster — the shared state of the project this session
is filed under. Not written by the user.

Project: Checkout rewrite
Splitting payments out of the monolith.

Repositories
- api — ~/work/api (you are here) — the monolith, Rails
- payments — ~/work/payments — the new service, Go
- shared-types — ~/work/shared-types — protobuf definitions, read-only

Project notes
…
```

`(you are here)` on `workspace.root` matters more than it looks: without it
the agent has three paths and no idea which one it is standing in, and
`pwd` is a tool call it should not have to spend.

**What the marker means before phase 2 exists.** Phase 1 ships this block
while deliberately changing nothing about where turns run, so there is no
`workspace.root` yet — the turn's directory is still `agent.cwd`, which may be
one of the listed repositories, or may be somewhere else entirely (on a fresh
install it is `~/roster/workspace`, which is none of them). The rule is
therefore:

> Mark the repository whose `path` matches the directory the turn will
> actually run in. In phase 1 that directory is `agent.cwd`; from phase 2 it
> is `workspace.root`. When nothing matches, **mark nothing** — do not fall
> back to marking the primary.

A brief with no `(you are here)` is expected in phase 1, not a bug: it is the
truthful rendering of "this agent is working outside every repository the
project lists", which is exactly the state phase 2 exists to fix. Marking the
primary anyway would assert something false, and the whole brief is built on
not doing that.

Because it is a plain equality test on two absolute paths, it needs
normalising or it will silently never match:

- **`~` expansion.** `agent.cwd` is already expanded by `expandHome` on read
  (`electron/main/store/agentToml.ts:142`), and `ProjectRepo.path` must store
  the absolute form for the same reason — `pathLabel` is the only place `~`
  belongs.
- **Trailing separators and `.` segments.** `path.resolve()` both sides before
  comparing; the directory picker and a hand-typed TOML value do not agree
  about trailing slashes.
- **Symlinks.** `realpath` both sides, or accept that a project listing
  `/Users/x/work/api` will not match an agent whose `cwd` is
  `/Users/x/Work/api` reached through a link. macOS also case-folds by default
  on APFS, so a case-insensitive compare is the pragmatic choice on darwin.
  This is fiddly enough to belong in one exported helper —
  `samePath(a, b): boolean` beside `resolveWorkspace` — used by the brief in
  phase 1 and by `resolveWorkspace` in phase 2, with a test for each of the
  three cases above.

Implementation is a fifth `Block` in `blocksOf()`, ordered first, with
`more: (n) => "(+${n} more repositories)"`. It needs one addition to
`ProjectBriefInput`:

```ts
  /**
   * The project's repositories, primary first. At most one carries
   * `isCurrent`, and none does when the turn runs outside all of them —
   * see "What the marker means" above.
   */
  repos?: readonly BriefRepo[]
```

and `withProjectBrief` passes them the same way it passes `notes`. The whole
change is well under a hundred lines, and `hasAlreadyRead` gets it right for
free: adding a repository changes the brief, so the next turn re-sends it,
which is exactly the behaviour that comment argues for.

### 5.2 The budget

`PROJECT_BRIEF_BUDGET = 2000` was chosen for a project with one implicit
checkout. A repository line costs roughly 60–80 characters, so:

| Repositories | Header + repos | Left for notes/tasks/comments |
|---|---|---|
| 1 (today, implicit) | ~150 | 1850 |
| 3 | ~380 | 1620 |
| 8 | ~780 | 1220 |

Three options:

**(a) Cap the block and leave the budget alone.** `REPOS_BUDGET_SHARE = 0.15`,
matching how `NOTES_BUDGET_SHARE` already works, with the trailer admitting
the rest. Eight repositories then cost 300 characters and the ninth onward is
`(+N more repositories)`.

**(b) Scale the budget: `2000 + 100 × repoCount`.** Simple, and wrong in the
direction that matters — the budget is a statement about *cost per turn*, not
about how much there is to say. A monorepo-of-six project would silently cost
half again as much on every turn of every session, which is exactly the
failure mode `PROJECT_BRIEF_BUDGET`'s comment warns about ("Every turn pays
this, so it is a cost, not a ceiling to fill").

**(c) Per-repository notes files** — `~/roster/projects/<id>/repos/<name>.md`,
each with its own share. Doubles the two-writer surface `ProjectNotesStore`
already has to handle, multiplies the budget arithmetic, and speculates that
users will write per-repo notes before any user has written one.

**Recommendation: (a).** Keep 2000. It is the number the app has been running
on and there is no evidence it is wrong; a project with more than eight
repositories has a naming problem, not a budget problem. Revisit only with a
real project that hits the trailer.

### 5.3 What "context per project" does *not* need

Worth stating, because it is where this could balloon:

- **No indexing, no embeddings, no repo summarisation.** The 2026-08-28 spec
  rejected retrieval over transcripts for reasons (offline, CSP, "what was
  said" is mostly noise) that apply identically to "what is in the repo".
- **No reading of `README.md` or `AGENTS.md` into the brief.** Every runner
  Roster drives already reads the repository's own agent instructions when it
  starts in that directory. Duplicating them into the brief would pay twice
  for the same text — and pay for it in the *wrong* repository, since the
  agent only auto-reads the one it is standing in. The honest fix for the
  secondary repositories is one line of `description` per repo, written by
  hand, which is what §3.1 has.

## 6. Migration and existing users

There is no schema data to migrate — migration 12 only adds a table. What has
to be handled is behaviour.

**An existing install with no project repositories behaves identically.**
`resolveWorkspace` falls through to `agent.cwd`, `additionalRoots` is empty,
the brief has no `Repositories` block because `blocksOf` omits a block with no
lines, and `codexPermissionOverrides([cwd])` produces byte-identical output to
`codexPermissionOverrides(cwd)` today. This is worth an explicit test:
*"a project with no repositories produces the brief it produced before"*.

**The first time a user adds a repository to a project, sessions filed under
it move.** An agent whose `cwd` was `~/work/api` and whose session is filed
under a project whose primary is `~/work/payments` will run in
`~/work/payments` on its next turn. That is the point of the feature and it is
also a surprise. Three mitigations, all cheap, all recommended:

1. The `Working in` row in the config rail, visible before the turn is sent.
2. When adding the *first* repository to a project, offer the distinct
   `cwd`s of agents that already have sessions filed under it as suggestions —
   most of the time the right primary is already sitting there.
3. Because the brief changes, `hasAlreadyRead` re-sends it, so the agent is
   told about the move in-band on the first turn after it happens.

**A path that no longer exists is shown, not hidden.** `runSubprocess` already
fails a turn cleanly with `working directory does not exist: <path>`
(`subprocess.ts:29`), so the failure mode is legible; `ProjectRepo.exists`
lets the UI mark it before the user finds out that way.

## 7. Tasks, sessions and worktrees across repositories

This is the genuinely hard part and the part I would ship last.

### 7.1 What breaks

`PlanFlow.approve` checks `isGitRepository(cwd)` for one directory.
`worktreeFor(plan)` returns one path with no repository in its name.
`buildPrompt` emits one `git worktree add` and one "Do all of your work in
X". `Plan.branch` and `Plan.prUrl` are single optional strings, and
`mcp__plans__record_pull_request` takes one URL.

A plan that legitimately touches two repositories has nowhere to be
represented at any layer.

### 7.2 Options

**A. One worktree per repository, one branch name.**
`~/roster/worktrees/<plan-slug>/<repo-name>/`, `buildPrompt` emits one
`git worktree add` per repository, one pull request per repository, and
`Plan.prUrl` becomes a `plan_pull_requests` child table with
`record_pull_request` called once per repo.

- For: it is what the work actually is, and worktree isolation — the property
  the whole plan flow exists to provide — survives.
- Against: real cost. A new table, a plural PR list in `PlanModal`, a longer
  and more failure-prone build prompt, and `removeSession`'s cleanup
  (`sessions/remove.ts:70`) grows a second thing to fail at. And it still does
  not solve the thing users will expect it to (§7.4).

**B. Worktree the primary; the rest are read-only context.** The plan branches
and opens a pull request in `workspace.root` exactly as today. Secondary
repositories reach the agent through `additionalRoots` and the brief, and the
build prompt says explicitly: *"The other repositories on this project are
available to read. Do not commit in them."*

- For: covers what I believe is the majority case — an app plus a library, a
  service plus its protobufs, a frontend plus the API it calls — where the
  second repository is something you need to *see* to write the first
  correctly. Zero schema change beyond §3.1. `PlanFlow.approve`'s existing
  guard just moves from `agent.cwd` to `workspace.root`.
- Against: an agent told not to commit may still commit. This is a prompt, not
  a sandbox — except under Codex, where the `roster-worktree` profile makes it
  nearly true, since only `gitDir`/`commonDir`/`worktreesDir()` are writable
  and a secondary root's working tree would be added read-only.

**C. No worktree at all for multi-repo plans; refuse to approve them.** Least
work, least useful, and it turns a soft limitation into a hard error.

### 7.3 Recommendation

**B now, A only if a real project asks for it.** Concretely: ship B in phase 3
and do not build the `plan_pull_requests` table until somebody has a plan that
needs two pull requests. Making the worktree path repository-aware —
`~/roster/worktrees/<plan-slug>/<repo-name>/` even when there is one
repository — is worth doing *inside* B, because it is the only part of A that
is expensive to retrofit once worktrees exist on disk under the old naming.

### 7.4 What none of these solve, and should not pretend to

**Cross-repository changes that must land together.** A breaking change in
`shared-types` plus the consumer update in `api` is two pull requests that
must merge in order, and Roster ships no git code, has no CI integration, and
cannot sequence merges. Option A produces two independent PRs and calls it
done, which is arguably worse than not offering it — the user thinks the tool
handled the coordination.

This should be said in the spec and in the UI, not designed around. Roster's
job here is to let one agent *see* and *change* two repositories in one
session. Landing those changes safely is the user's, or their merge queue's.

**Tasks do not gain a repository.** A `tasks.repo_id` is the obvious next
thought and I would not add it: a task is a unit of work, most tasks that
matter cross the boundary, and the field would be wrong or empty far more
often than it was useful. If a task needs to say which repository it is about,
the description already can.

## 8. UI

Small, and mostly reuse.

**`src/screens/ProjectsModal.tsx`** — the edit form gains a `Repositories`
list under the description: rows of name + `pathLabel`, drag or arrow to
reorder, `Primary` on position 0, and an `Add repository` button calling the
existing `CHANNELS.dialogChooseDirectory` (`shared/ipc.ts:472`) that the agent
picker already uses — the `WorkingDirectory` component
(`src/components/AgentFields.tsx:151`) is close enough to reuse as the row.
The dialog handler returns `result.filePaths[0]` and sets no `multiSelections`
(`electron/main/ipc/index.ts:662`), so repositories are added one at a time.
That is fine and I would not change it: adding a repository also means naming
and describing it, which is a per-repository act anyway.

Validate with the existing `isGitRepository` and **warn
rather than refuse** — a docs folder or a data directory is legitimate context
that is not a checkout, and only the primary has to be a repository (for
`PlanFlow.approve`). Name defaults to `basename(path)`; description is a free
single line.

**`src/screens/AgentDetail.tsx`** — `Directory` → `Default directory` at
`:466`; the config rail's `SessionProject` row (`:666`) is joined by a
`Working in` row; and `TerminalPane` at `:272` takes `workspace.root` /
`workspace.rootLabel` instead of `agent.cwd` / `agent.cwdLabel`, so the
terminal opens where the agent is actually running. That last one is a bug fix
as much as a feature — today the terminal and the turn are guaranteed to agree
only because both read the same field.

**`src/screens/AgentsGrid.tsx:162`** keeps showing `cwdLabel`; an agent's card
is about the agent, not about one of its sessions.

**A custom-runner note.** Where a project has more than one repository and an
agent on it uses a custom runner, the `Working in` row should say
`(other repositories not available to this runner)`. Better a plain sentence
than a silent difference in capability.

## 9. Phases

Each ships on its own and is worth having alone.

### Phase 1 — the project knows its repositories

Migration 12, `ProjectRepoStore`, the `ProjectRepo` type, IPC
(`projects:repos:list|add|update|remove|reorder`), the `Repositories` section
in `ProjectsModal`, and the `Repositories` block in `projectBrief.ts` under
`REPOS_BUDGET_SHARE`.

Also `samePath`, and the `(you are here)` marker computed against `agent.cwd`
rather than `workspace.root`, since `resolveWorkspace` does not exist yet —
including the case where it marks nothing. See §5.1.

Nothing about where turns run changes. The whole value is that agents on a
multi-repo project **stop having to be told the second repository exists** —
which, in my judgement, is the single largest share of the pain in the TODO
line, for the smallest change.

Verifiable: add two repositories to a project, open a session on it, and the
agent names both without being told. Then a second case, which is the one that
catches a wrong marker: point the agent's `cwd` at neither repository and
check the block lists both and marks neither.

### Phase 2 — turns run where the project says

`resolveWorkspace`, `sessions.repo_id` (migration 13, write-once per §3.4),
`StartOptions.additionalRoots`, the Claude `additionalDirectories` change,
`codexPermissionOverrides` taking a list, `TerminalPane` and the `Working in`
row.

Verifiable: one agent, one session, edits a file in each of two repositories
in one turn, under both Claude and Codex.

### Phase 3 — plans in a multi-repo project

`PlanFlow.approve` checks `workspace.root`; `worktreeFor` becomes
`worktreeFor(plan, repo)` returning `<worktrees>/<plan-slug>/<repo-name>`;
`buildPrompt` names the secondary repositories as read-only. Option 7.2 B.

### Phase 4 — only if a real project needs it

Per-repository worktrees and multiple pull requests per plan (7.2 A). Do not
start it speculatively.

**What I would actually build: phases 1 and 2.** Phase 1 is roughly a day and
delivers the bulk of the benefit; phase 2 is two or three and delivers the
rest of what the TODO asks for. Phase 3 is worth doing only once phase 2 is in
daily use, and phase 4 probably never.

## 10. Open questions

Three I cannot settle without a decision.

### 10.1 Does the project override the agent, or does the agent win?

Recommended above: the project's primary beats `agent.cwd`. The alternative is
that `agent.cwd` always wins unless it is still the untouched default
`~/roster/workspace`, which never surprises anyone and makes the feature nearly
invisible — a user who set up agents pointing at checkouts (which is the
documented way to use Roster today) would add repositories to a project and
observe no change at all.

There is a third option: make it explicit and refuse to guess — when a session
is filed under a multi-repo project and has no `repo_id`, the config rail shows
`Working in — not set` and the turn fails with a message rather than picking.
Safest, most annoying.

**Recommendation: project wins, with the `Working in` row making it visible.**
But this is a real behaviour change for existing installs and is the user's
call.

### 10.2 Should `Agent.cwd` survive at all?

§4 keeps it. The case for removing it is that "an agent is a persona, a project
is a place" is a cleaner model, and `Agent.cwd` is the last thing muddying it.
The case against is that it makes every session require a project, which is a
much larger change to how Roster is used, touches first-run
(`store/defaultAgents.ts:81` seeds three agents at `~/roster/workspace`), and
is not needed for anything in phases 1–3.

**Recommendation: keep it, revisit after phase 2** — by then there will be
evidence about how often `source: 'agent'` is what actually resolves.

### 10.3 How much isolation do secondary repositories get?

Under Claude, `additionalDirectories` is read **and write**; the SDK has no
read-only mode. So in phase 2 an agent can edit any repository on the project,
and 7.2 B's "do not commit in the others" is prompt-level only. Under Codex it
is close to enforced by the sandbox profile.

The options are: accept the asymmetry and document it; hold secondary
repositories out of `additionalDirectories` for Claude and give it read access
some other way (there isn't a clean one); or make writability a per-repository
flag, which is a column and a UI control that only Codex could honour.

**Recommendation: accept and document.** A flag Roster cannot enforce on its
primary runner is worse than an honest sentence.

## 11. Risks

- **Scope creep into a workspace manager.** Every question in §7 has a bigger
  answer that involves Roster running git. It should not. `repo.ts`'s "Roster
  deliberately ships no git code" is the line that keeps this feature small,
  and phases 1 and 2 do not cross it.
- **Brief cost grows quietly.** §5.2 caps it, but the cap only helps if
  somebody looks — the context-window bar in the config rail is where an
  overspending brief shows up first, and it is worth checking against a
  five-repository project before phase 1 ships.
- **The `Working in` row is the whole safety story for §6.** If it is not
  built in the same phase as `resolveWorkspace`, phase 2 becomes "my agent
  started editing a different repository and did not say".
- **Codex override churn.** `tests/main/runners.test.ts:112-217` pins the exact
  permission strings and the `-C` argument. Widening to a list is correct but
  will look like a large diff in a security-relevant file; it deserves review
  attention out of proportion to its size.
- **Fixture churn is wide and shallow.** `Agent` gains nothing, but `Session`
  gains `repoId` and `StartOptions` gains `additionalRoots`, so
  `tests/renderer/factories.ts:22`, `tests/main/fixtures/agents.ts:10` and the
  `cwd:` assertions in `sessionManager.test.ts:654`, `planFlow.test.ts:19,54`
  and `runners.test.ts:66` all move together. Worth doing in one commit rather
  than trickling through the phases.
- **Codex's "the working directory is fixed" rule will read as a bug.** §3.4
  is correct and will still generate the question "why can't I change it?".
  The disabled picker needs the sentence, not just the disabled state.
- **Two writers on `project_repos` is not a problem, and it is worth noticing
  why.** Unlike `NOTES.md`, no agent can add a repository — there are no MCP
  tools for it and there should not be. A tool that let an agent point the
  project at a new directory would be the sharpest privilege escalation in the
  app.

## 12. What this plan does not do

It does not make a project own its agents, does not make a task own a
repository, does not add git operations to Roster, and does not attempt to
land coupled changes across repositories atomically. Each of those is a
plausible next feature and none of them is this one.
