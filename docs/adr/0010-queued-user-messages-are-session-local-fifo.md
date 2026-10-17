# ADR 0010: Queue user messages as session-local FIFO turns

## Context

Roster previously disabled the chat composer while an agent was running. The
session manager had a single follow-up slot for Roster-originated turns, but a
new item replaced any older one. That is suitable for superseding internal
plan actions, but it loses a person's messages and prevents them from adding
context while a long plan or implementation turn runs.

## Decision

Use one in-memory FIFO queue per session. Every submitted message retains its
prompt and per-turn options, and runs in submission order after the active
turn finishes. The main process emits the queued count, which the renderer
shows while leaving the composer enabled. A prompt is recorded immediately
before its queued turn starts, preserving transcript execution order.

Stopping or deleting a session clears its queued turns. The queue is not
persisted across application restarts: it is outstanding runtime work, like
the active runner stream, rather than completed session history.

## Consequences

People can continue supplying instructions without silently replacing an
earlier one. The pending-count event makes that state visible. A stop remains
a clear cancellation boundary for both active and queued work.
