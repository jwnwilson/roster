# 0004 — Decision-needed is session approval

Date: 2026-09-11

## Status

Accepted

## Context

The design handoff calls the attention state `approval` and renders it to
people as “needs you.” A session can be blocked by either a command that needs
approval or a structured question that needs an answer. The agent grid must
make that blocked work discoverable, while the agent detail must take the user
to the specific session and decision.

Roster already persists `Session.status` and `Approval` records, and its
session-status roll-up gives `approval` priority over running and finished
work. Creating a separate `decision_needed` status or a second decision table
would duplicate runner lifecycle state and risk the card and the detail view
disagreeing.

## Decision

Use a pending `Approval` on a session as Roster's decision-needed state.

- Keep the persisted status value `approval` and the existing public wording
  “needs you,” which match the design handoff.
- Treat both command approvals and structured questions as decision-needed.
- Derive an agent's attention state from its sessions with the existing status
  roll-up; do not persist a second agent-level flag.
- Highlight the affected session wherever sessions are navigated: its status
  dot remains amber, and its grid chip and detail tab receive an accessible
  amber attention treatment. The enclosing agent card keeps the handoff's
  amber pulsing border.
- Keep the decision payload and its resolution in `Approval`; no task/project
  decision model or database migration is part of this work.

## Consequences

The runner protocol, SQLite schema, and approval-resolution flow stay single
sourced. A user can see which session needs them before opening an agent, then
reach the existing command controls or question controls directly. This does
not create durable architectural-decision records; those continue to belong in
project notes and ADRs.
