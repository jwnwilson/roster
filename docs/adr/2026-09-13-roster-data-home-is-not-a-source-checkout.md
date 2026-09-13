# Roster data home is not a source checkout

## Status

Accepted — 2026-09-13

## Context

Roster persists its database, agents, skills, plans, MCP configuration, workspace,
and generated worktrees beneath `~/roster` by default. That location is user data,
not application source.

On this machine, an older Git clone was also present at `~/roster`. The two uses
therefore shared one directory, making normal application data appear in a project
checkout and putting generated state alongside tracked source files.

## Decision

`~/roster` remains Roster's default data home. It must not contain a Roster source
checkout. Source checkouts belong in a separate directory such as
`~/projects/roster`; development and test runs that need isolated state must set
`ROSTER_HOME` to a private temporary directory.

The application will continue to honour `ROSTER_HOME` as an explicit override.

## Consequences

The existing source checkout at `~/roster` must be relocated or retired before its
tracked source files can be removed, preserving its Git history. Its Roster data
files remain in place. Future setup and development documentation should make the
separation explicit, and a follow-up may add a startup warning when the configured
data home contains a Git repository.
