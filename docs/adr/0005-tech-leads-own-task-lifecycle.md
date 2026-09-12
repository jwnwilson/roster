# ADR 0005: Tech leads own the task lifecycle

## Status

Accepted — 2026-09-12.

## Context

The default Tech Lead prompt encouraged decomposition and ADRs, but did not
make the Roster task board the source of work progress or require independent
validation before completion. That allowed work to lose its status, handoffs,
and verification evidence.

## Decision

Default Tech Leads must find or create a task before substantive work, own its
status and progress updates, and record each material finding, handoff, and
validation outcome there. They decompose and delegate bounded work with an
expected result, recording durable technical decisions as ADRs.

The lead validates implementation directly, preferring the local app when
practical. Non-trivial validation goes to QA. A task is complete only after
validation; the lead continues autonomously until that point, a user decision,
or a plan review is needed.

## Consequences

* The board is a reliable account of active work and its evidence.
* Delegated work has a clear owner, scope, and acceptance result.
* Default Tech Lead agents finish with verified outcomes instead of unvalidated
  implementation claims.
* Existing user-edited agent prompts are not migrated; this governs newly
  seeded Tech Leads.
