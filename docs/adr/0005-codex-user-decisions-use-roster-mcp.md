# ADR 0005: Codex user decisions use Roster MCP

## Context

An assistant asking for confirmation in prose does not create Roster's
decision UI. Roster only shows that UI for a pending approval with structured
questions. Codex runs in a separate process but Roster already gives it a
per-turn, authenticated STDIO MCP bridge for its own tools.

## Decision

Expose `roster.request_user_decision` through the shared Roster MCP server.
The tool creates a normal pending approval and waits for the user to answer.
Its structured answers are returned to the calling agent. The same tool is
registered for Claude and Codex so their decision contract cannot drift.

## Consequences

The renderer and notification logic continue to consume one approval shape;
they do not need to infer intent from assistant prose. The MCP bridge remains
scoped to one turn and its authenticated socket, so a terminated or unrelated
Codex process cannot submit a decision. A stopped turn must resolve any
waiting decision tool calls so no MCP child is left blocked.
