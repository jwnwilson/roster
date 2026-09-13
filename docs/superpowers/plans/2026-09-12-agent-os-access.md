# Agent OS Access Implementation Plan

**Goal:** Let a Roster agent work outside its checkout or use macOS automation
when a user has explicitly enabled that access, without weakening every agent
by default.

**Diagnosis:** `CodexRunner.run` builds a `roster-worktree` profile in
`electron/main/runners/codex.ts`. The profile extends `:workspace`, then
whitelists only Git metadata and Roster's worktree directory. It is passed with
`--ignore-user-config --strict-config` on every `codex exec` and `exec resume`.
Consequently, the user's `~/.codex/config.toml` cannot broaden it. Electron's
renderer setting (`sandbox: false`) is unrelated. Codex CLI 0.149.0 supports
`--sandbox read-only|workspace-write|danger-full-access` and `--add-dir`;
Roster currently requires Codex 0.138.0 or newer.

**First piece:** implement the persisted access model and its backwards-safe
migration first. Every later layer—the editor, runner, and confirmation—must
have one source of truth, and this makes existing agents demonstrably remain
workspace-only.

## Work breakdown and handoff expectations

1. **Configuration contract and migration (Implementer)**
   Add a versioned agent access setting: `workspace`, `selected-folders`, or
   `macos-automation`, plus a list of folders for the middle mode. Parse absent
   configuration as `workspace`; reject unknown modes, non-absolute paths,
   duplicates, and paths that do not resolve to directories. Do not resolve
   symlinks inconsistently between validation and launch. Return: failing-then-
   passing store tests, the migration, and a short compatibility note.

2. **Codex runner enforcement (Implementer)**
   Replace the fixed permission builder with a builder driven solely by the
   stored access setting. Workspace reproduces today's argv byte-for-byte.
   Selected folders adds only canonicalised user selections to the writable
   filesystem map (or Codex's supported equivalent). macOS automation invokes
   `--sandbox danger-full-access`; it must not add
   `--dangerously-bypass-approvals-and-sandbox`. Apply the same construction to
   initial, resume, and fork invocations. Return: exact argv tests for all
   modes, plus an integration test that a selected folder can be written while
   an unselected sibling cannot.

3. **Explicit consent UX (Implementer)**
   Add the access control to New/Edit Agent. Folder mode uses a native directory
   chooser and lists exact paths. The macOS-automation choice requires a typed
   or equivalent deliberate confirmation explaining full user-account access,
   lack of per-command Codex approvals, and macOS's separate permission
   prompts. Show a persistent elevated-access badge on the agent/session.
   Return: renderer tests for the default, folder list, cancellation, and
   confirmation reset when the mode changes.

4. **macOS/TCC acceptance run (Reviewer)**
   In a signed-in test macOS account, exercise: workspace cannot write Desktop;
   selected-folders writes only a chosen temporary directory; automation can
   perform an innocuous `osascript` action after the normal macOS prompt; and a
   denied TCC prompt produces an actionable Roster-visible failure. Repeat in
   the packaged `.app`, not only `npm run dev`. Return: test evidence, exact
   macOS version, prompted entitlement, and any product/documentation gaps.

5. **Security review and release (Tech Lead)**
   Review the migration, runner argv, confirmation copy, and manual evidence.
   Verify no global config, agent prompt, task, skill, MCP server, or handoff
   can elevate access; a handoff uses the target agent's own stored mode. Run
   `npm test`, `npm run typecheck`, and `npm run check`; then open a PR.

## Acceptance criteria

* An existing agent still has workspace-only access after update.
* Folder access is explicit, persists, is displayed, and cannot include an
  arbitrary non-directory or uncanonicalised duplicate.
* The generated Codex argv is correct for initial and resumed turns in all
  modes, with full access never using Codex's bypass flag.
* A user cannot enable macOS automation accidentally or through agent output.
* Packaged-app testing distinguishes a Roster sandbox failure from a macOS TCC
  denial and tells the user what they can do next.

## Rollout and fallback

Ship the setting behind its default `workspace` value. If a Codex version does
not support the full-access invocation, keep the agent runnable in workspace
mode and show the upgrade requirement rather than silently broadening access.
If an elevated run fails, reverting the agent to workspace mode immediately
restores the existing profile; no global setting or database reset is needed.

## Non-goals

* Bypassing macOS TCC, Gatekeeper, SIP, or a user's organisation policy.
* Per-command approval for Codex, which its current subprocess integration
  cannot provide.
* Changing Claude or custom runner access in this work; they need separate
  adapter-specific decisions.
