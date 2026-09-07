# ADR 0003: Allow bounded agent-to-agent task mention loops

## Status

Accepted — 2026-09-06

Supersedes ADR 0002's rule that all agent-authored task comments are inert.

## Context

An agent that completes delegated work needs to be able to notify another
agent through the task thread. The current implementation dispatches mentions
only from a person's `tasks:comment` request; comments written through an
agent's `comment_on_task` MCP tool are visible on the board but do not reach a
mentioned agent.

Routing all agent comments through the existing dispatcher would create
unbounded autonomous turns and spend. Comment author names and generic session
handoff ancestry cannot safely express which task-comment chain caused a
delivery, especially because task sessions are reused.

## Decision

Enable agent-to-agent mention loops, including feedback such as A → B → A,
but make every delivery part of a persisted, bounded task-mention chain.

* A human comment starts a root chain.
* An agent comment can dispatch only when it carries provenance for a delivery
  already in that chain. Unrelated agent comments remain inert.
* A delivery records its root comment, parent delivery, source session, target
  agent, depth, and outcome. Agent comments retain their author session and
  parent-delivery reference.
* Reservations happen atomically before a turn begins. The first release
  allows at most three hops after the root and at most sixteen delivery
  reservations per root chain, including failures. A cycle is permitted while
  it remains within those limits.
* The active session run carries its delivery reference so both an agent's
  explicit `comment_on_task` calls and Roster's automatic reply comments
  retain the chain provenance.

The depth matches Roster's existing handoff depth. The delivery cap bounds
fan-out, which depth alone does not.

## Consequences

* `@agent-id` in a delivery-bound agent comment becomes a genuine, finite
  agent-to-agent notification.
* A → B → A is possible, but no chain can silently continue past its depth or
  delivery budget.
* The task-comment schema and internal runner context gain additive
  provenance; the public `comment_on_task(task_id, text)` API remains stable.
* Limit exhaustion must be visible in the task thread or MCP response so work
  does not appear to have been delivered when it was not.
