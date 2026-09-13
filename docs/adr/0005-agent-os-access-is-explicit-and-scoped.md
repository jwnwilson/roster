# ADR 0005: Agent OS access is explicit and scoped

## Status

Accepted — 2026-09-12

## Context

Roster launches Codex with an application-owned `roster-worktree` permission
profile. It extends Codex's `:workspace` sandbox and grants write access only
to the selected checkout, the Git metadata needed for worktrees, and Roster's
worktree root. It deliberately ignores the user's Codex configuration.

That makes a Codex agent unable to read or write normal macOS locations such
as Desktop, Documents, Applications, or another project. It also prevents
workflows that need to call macOS automation tools over files outside the
repository. The Electron renderer is not the restriction; the profile passed
to the spawned `codex exec` process is.

Removing the sandbox globally, or using Codex's
`--dangerously-bypass-approvals-and-sandbox` flag, would silently give every
agent unrestricted access under the user's account. Codex turns do not expose
a callback Roster can use to approve each shell action. macOS Transparency,
Consent, and Control (TCC) prompts are a separate user-controlled boundary;
Roster must not attempt to bypass them.

## Decision

Keep workspace-only access as the default and make elevated access an explicit
per-agent setting. Roster will support these ordered access modes:

1. **Workspace** — the current `roster-worktree` profile.
2. **Selected folders** — workspace access plus user-chosen, canonicalised
   directories. Each selected directory is writable by the Codex turn; the UI
   shows the exact paths before saving.
3. **macOS automation** — unrestricted filesystem/process access for the
   named agent, enabled only after an interstitial confirmation explains that
   its commands run as the signed-in macOS user. This mode must not be the
   default, inherit into another agent, or be enabled by a prompt or MCP tool.

The runner remains the single enforcement point. It derives Codex command-line
overrides from the stored mode on every initial, resumed, and forked turn, and
continues to ignore global Codex configuration. The full-access mode may use
Codex's supported `danger-full-access` sandbox selection, but must never use
its bypass-approvals-and-sandbox flag.

TCC access remains opt-in outside Roster. When an agent first needs an
Automation, Accessibility, screen-recording, Files & Folders, or Full Disk
Access entitlement, macOS may prompt or deny it. Roster documents the exact
System Settings path and reports the command's actionable error; it does not
claim that enabling the Roster setting grants that entitlement.

## Consequences

* Existing agents retain their least-privilege behaviour after migration.
* Users can enable ordinary multi-folder work without exposing their whole
  account, and can deliberately opt into OS automation when they need it.
* Codex sessions receive no per-command approval banner in elevated mode, so
  the confirmation and persistent access indicator are essential.
* The implementation needs agent configuration migration, runner argv tests,
  UI tests, and manual macOS TCC verification on a packaged app.
