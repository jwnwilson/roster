# ADR 0005: Periodically check in on inactive task sessions

## Status

Accepted — 2026-09-11

## Context

Roster can start an agent session from a task mention, but a turn completing
does not establish that the task was completed, blocked, or moved on the
board. An assigned task can therefore remain In Progress after its agent has
stopped working, with no later signal to bring it back to the agent's
attention.

`SessionManager` knows whether a runner is live only in memory. Its persisted
session status is useful to render the last state, but cannot establish that a
runner survived an app restart. Task-linked sessions and task assignment are
durable, so they are the safe basis for an automated follow-up.

## Decision

Roster runs one liveness monitor while its main process is open. It checks
every 5 minutes and once at startup. A candidate must be a task-linked
session whose task is both `in_progress` and assigned to that session's agent.
The monitor skips a session with a currently live runner.

Before queuing a normal agent turn, the monitor persists `last_nudged_at` on
the session. A session is ineligible until 5 minutes after that timestamp.
This provides a durable cooldown across app restarts and prevents overlapping
checks from starting duplicate turns. The check-in appears in the transcript
as authored by Roster and asks the agent to continue, leave a blocker or next
step, or update the task status.

The monitor never changes a task itself, never polls sessions unrelated to a
task, and is not a background daemon. The agent decides the appropriate task
comment and status using its normal task tools. At startup Roster changes any
persisted `running` session to `done`, because the runner cannot survive the
process that owned it.

## Consequences

* In-progress work regains attention without a human needing to remember to
  re-mention its agent.
* An automated check can consume a normal agent turn, but no more than one per
  eligible task session per 5-minute interval.
* Tasks without a session, task sessions assigned to someone else, and tasks
  in review or done are deliberately untouched.
* Roster does not need a separate scheduler process; closing the app stops
  checks, and reopening it safely resumes from the persisted cooldown.
