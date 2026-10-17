# ADR 0012: Create missing assignee sessions during task check-ins

## Status

Accepted — 2026-10-17

## Context

The liveness monitor only finds tasks through existing sessions. An assigned
in-progress task without a session is therefore never checked, including when
its assignee changes to an agent that has not yet worked on it.

## Decision

Before each startup/five-minute check, inspect in-progress tasks and create a
task-linked session for each known assignee that has none. File the session
under the task's project and broadcast its attachment to the board. Reuse an
existing task/assignee session instead of creating a new one every tick: this
preserves context and the durable cooldown and avoids duplicate work.

Check-in prompts include the task description and recent non-system comments,
using the existing bounded task briefing format. Agents must use task tools
for progress and status updates; replies are not automatically posted as
comments. Active sessions are skipped and cooldowns remain persisted.

Unassigned tasks, missing agents, and backlog, to-do, in-review, and done tasks
remain excluded. This change targets in-progress recovery; it does not
authorize automatic review, approval, or merging.

## Consequences

Assigned in-progress work no longer requires a manual mention to start its
session. Reassignment gets a session for the new assignee without nudging the
old one. Checks only run while Roster is open and may consume paid turns.
They cannot guarantee completion or resolve missing permissions or human
decisions. Closing a session while its task remains assigned and in progress
allows the next check to recreate it; change task status or assignment to stop
the automatic follow-up.
