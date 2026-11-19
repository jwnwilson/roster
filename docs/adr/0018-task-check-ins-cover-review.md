# ADR 0018: Task check-ins cover in-review work

## Status

Accepted — 2026-11-19

## Context

ADR 0012 limited session recovery and liveness check-ins to assigned
in-progress tasks. Assigned tasks in review can also wait on an agent to
continue useful review work or report a blocker, but were excluded entirely.

## Decision

Supersede ADR 0012's exclusion of in-review tasks. Startup and five-minute
checks now recover missing assigned sessions and nudge existing sessions for
both `in_progress` and `in_review` tasks. The prompt identifies the active
status. Review prompts ask the owner to check progress, continue useful work,
or report a blocker or next step and update the status.

Review prompts explicitly preserve review gates: a check-in never authorizes
automatic approval or merging. Existing exclusions for unassigned tasks and
missing agents, persisted cooldowns, streaming-session skips, task context,
and reassignment handling remain unchanged.

## Consequences

Review work receives the same app-open and five-minute follow-up cadence as
in-progress work. Moving a task to any other status stops recovery and
check-ins. The mechanism still does not guarantee completion or replace human
review decisions.
