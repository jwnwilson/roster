# ADR 0002: Agents archive sessions; only people delete them

## Status

Accepted — 2026-11-15

Supersedes the removal semantics of
[ADR 0001](0001-agent-initiated-subsession-closure.md). ADR 0001's scoping rule
(an agent may act only on sessions it spawned) still holds.

## Context

ADR 0001 let an agent `close_session` a child, which permanently removed the
transcript, plans and spend. That made the agent's cleanup irreversible, and
gave an agent the power to destroy a record a person may still want. Users also
had no way to put a session away without losing it: the only control was
Delete, which removed it outright.

## Decision

A session can be **archived**. Archiving takes it out of its agent's list, the
sidebar and the grid, but keeps everything: transcript, plans, spend and any
task link. An archived session can be **restored**, and a mention on its task
continues it rather than opening a second conversation.

- The agent `close_session` tool now **archives**. It keeps its name, is scoped
  to direct children it spawned, and is not destructive. Agents cannot delete.
- Only a person can **permanently delete**. That lives in the Archived view,
  behind a confirmation that says it cannot be undone. Deleting an active
  session is refused; it must be archived first.
- Archiving is **refused while a turn is running** with "Stop it first". The
  turn is not stopped for the user, unlike the old delete.
- Spend totals keep counting archived sessions; they are history, not
  inventory.
- Sessions deleted before this decision are not recoverable.

## Consequences

* An agent's cleanup can always be undone by a person.
* The tool's destructive hint is `false` for every roster tool; the MCP
  annotation now matches what the tool does.
* Permanent removal still runs through the one lifecycle in
  `electron/main/sessions/remove.ts`, so the stop-PTY, cascade and plan-file
  steps are unchanged.
* Archived rows stay in SQLite. Queries that feed the live UI, check-in
  candidates and the recent-transcript cards exclude them explicitly; spend
  does not.
