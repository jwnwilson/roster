# ADR 0009: `ROSTER_HOME` defines the Electron instance boundary

## Status

Accepted — 2026-10-17

## Context

`ROSTER_HOME` already isolates Roster's SQLite database, agent configuration,
and workspace files. Electron used its default `userData` directory instead,
which also contains Electron's single-instance lock. Two development runs with
different `ROSTER_HOME` values therefore still collided: the later process
exited before opening a window.

## Decision

When `ROSTER_HOME` is explicitly set, configure Electron's `userData` path to
that same directory before acquiring the single-instance lock. Leave
Electron's standard path unchanged when the variable is absent.

## Consequences

* Isolated development runs have isolated databases, settings, and
  single-instance locks.
* Production users who do not set `ROSTER_HOME` retain the existing Electron
  profile location and one-instance behavior.
* A path explicitly supplied through `ROSTER_HOME` must be suitable for both
  Roster state and Electron user data.
