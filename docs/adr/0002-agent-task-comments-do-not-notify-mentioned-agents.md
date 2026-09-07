# ADR 0002: Agent task comments do not notify mentioned agents

## Status

Accepted — 2026-09-06

## Context

Roster task comments may contain `@agent-id`. A human comment is routed through
`TaskMentions`, which opens or resumes the mentioned agent's task session.

Agents post through `comment_on_task` instead. Those comments are persisted
and broadcast to task-board renderers, but do not enter `TaskMentions` and do
not reach another agent's live session. This can be surprising when an agent
uses `@tech-lead` as a completion notification.

## Decision

Keep agent-authored comments inert. An `@mention` in one is display text, not
a notification or session event.

This prevents automatic agent-to-agent mention chains and the unbounded loop
where one agent's generated reply mentions another agent which replies in
turn. A task comment remains a durable board record, not a reliable callback
to an agent that delegated work.

If Roster needs agent-to-agent completion notification, add an explicit,
bounded delivery action (for example `notify_agent`) that records the target,
correlation to the delegated session or task, and a depth/loop guard. It must
not be implemented by routing every agent comment back through `TaskMentions`.

## Consequences

* A lead cannot rely on `@lead` in an implementer's task comment to interrupt
  or notify its session.
* The board still receives the comment event and shows it to people who are
  viewing the task.
* Delegation workflows need a separate completion signal until the explicit
  notification capability exists.
