# Working in this repo

**Every task gets its own worktree, its own branch, and a pull request.** Nobody
edits `main` directly, and no session ends with uncommitted files lying around.

This is not ceremony. Both rules exist because of something specific about this
repo, explained below.

---

## Why `main` is off limits

`.github/workflows/release.yml` runs on **every push to `main`**. A push there is
not a commit — it is a version bump, a tag, a signed DMG for both macOS
architectures, and a GitHub release that the app's own updater offers to
everyone running Roster.

`npm run check` gates that workflow, but it runs *after* the push. Work landed
straight on `main` therefore either ships or breaks the release pipeline for the
next person. Go through a PR, where the gate runs before the merge.

## Why a worktree, not just a branch

Several agent sessions work this repo at the same time — `git worktree list`
usually shows two or three. A single shared checkout means:

- One session's half-finished edits show up in another session's `git status`,
  and get swept into the wrong commit. This has already happened.
- `git checkout` under a running `npm run dev` rewrites files out from under the
  dev server and the Electron main process.

A worktree gives each task its own directory on its own branch, so parallel work
cannot collide. Same `.git`, separate working trees.

---

## Starting a task

**1. Create the worktree.** These project instructions are the authorization the
`EnterWorktree` tool requires — use it, with a name shaped like the branch you
want:

```
EnterWorktree(name: "feat/agent-presets")
```

That creates `.claude/worktrees/feat+agent-presets` on branch
`worktree-feat+agent-presets`, branched from `origin/main` (not from whatever
`main` happens to be locally), and moves the session into it.

By hand, if you prefer or the tool is unavailable:

```bash
git fetch origin
git worktree add .claude/worktrees/feat+agent-presets -b feat/agent-presets origin/main
```

Branch names follow the commit types: `feat/`, `fix/`, `refactor/`, `docs/`,
`test/`, `chore/`, `perf/`, `ci/`.

**2. Install.** A fresh worktree has no `node_modules`, and this is not optional
here — `postinstall` runs `electron-builder install-app-deps`, which rebuilds
`better-sqlite3` and `node-pty` against Electron's ABI. Nothing runs without it.

```bash
npm install
```

**3. Point the app somewhere private if you run it.** Every worktree shares one
`~/roster` and one port 5173, so two dev instances will fight over the same
SQLite file and the same agent configs:

```bash
ROSTER_HOME=/tmp/roster-agent-presets npm run dev
```

---

## Finishing a task

**1. Run the gate.** This is the exact command CI runs — typecheck, coverage
thresholds, and a production build:

```bash
npm run check
```

**2. Commit everything.** Conventional format, imperative subject:

```
<type>: <description>

<optional body explaining why, not what>
```

**3. Open the PR.**

```bash
git push -u origin feat/agent-presets
gh pr create --fill
```

The PR body should cover the whole branch, not the last commit —
`git diff main...HEAD` is the change under review.

**4. Leave the worktree clean.** Everything committed and pushed before you
finish. `ExitWorktree(action: "keep")` to come back to it later,
`ExitWorktree(action: "remove")` once the PR is merged.

---

## Never

| Don't | Instead |
|---|---|
| Commit to `main`, or push to `origin/main` | Branch in a worktree, open a PR |
| End a session with uncommitted or untracked files | Commit and push, or explicitly say what you left and why |
| Commit files another session was mid-edit on | Stay in your own worktree; `git add` paths, never `git add -A` in a shared checkout |
| Merge your own PR without review being asked for | Push it and hand over the URL |
| Leave scratch scripts, screenshots, or logs in the repo | Use the session scratchpad directory |

Throwaway `ROSTER_SCRIPT` files, `ROSTER_SCREENSHOT` PNGs, and dev logs belong
outside the repo. `coverage/`, `out/`, `release/` and `*.log` are already
ignored; nothing else should need to be.

## Already on `main` with changes?

Stashes are shared across worktrees, so move the work rather than redoing it:

```bash
git stash
git fetch origin
git worktree add .claude/worktrees/fix+thing -b fix/thing origin/main
cd .claude/worktrees/fix+thing
npm install
git stash pop
```

---

## Verification before any PR

```bash
npm test          # full suite, ~5s
npm run typecheck # both tsconfigs
npm run check     # what CI runs — typecheck + coverage + build
```

Coverage thresholds are enforced in `vitest.config.ts`: 80% statements, lines and
functions, 70% branches. Tests come first — write the failing test, then the
implementation. See `README.md` for how the suite is organised and how the
end-to-end harness works.
