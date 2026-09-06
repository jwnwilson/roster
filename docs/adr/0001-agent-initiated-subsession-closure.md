# ADR 0001: Agents may close only sessions they spawned

## Status

Accepted — 2026-09-06

## Context

Agents can open sessions on other agents through Roster's built-in MCP server.
Those child sessions may complete, become unnecessary, or be blocked. The
originating agent currently has no way to clean them up, leaving stale sessions
in the roster until a person deletes them from the UI.

Roster already has one safe removal lifecycle: stop an active turn, wait for it
to finish writing, close its PTY, remove the database session and dependent
records, remove plan files, and publish `session-deleted`. A second, MCP-only
cleanup path would risk bypassing one of those steps.

## Decision

Expose a `close_session` tool on the built-in `roster` MCP server. It accepts a
`session_id` and delegates to the existing session-removal lifecycle.

The tool is scoped to the current session: it may close only a session whose
`spawnedFrom.sessionId` equals the caller's session id. It cannot close the
caller, an ancestor, a sibling, or an independently created session. Unknown,
already-closed, and unauthorised ids return a clear tool error without changing
state.

Here, **close** means permanent removal, matching the existing UI's cleanup
semantics. The tool response must say this explicitly. If preserving a
transcript is later required, it should be designed as an archive lifecycle,
not silently overloaded onto `close_session`.

The removal is destructive and must be marked with MCP's destructive hint. The
same tool definition remains the source of truth for Claude's in-process MCP
server and Codex's bridged stdio MCP server.

## Consequences

* Agents can clean up only the work they delegated, without gaining broad
  control over a user's roster or another agent's work.
* Active children are stopped before deletion, so cleanup cannot leave an
  orphan runner or continued database writes.
* The implementation needs the current session id at tool-construction time,
  not just the current agent id.
* Closing removes the child transcript and any plans it owns; callers need a
  deliberate archive feature if that history must be retained.
