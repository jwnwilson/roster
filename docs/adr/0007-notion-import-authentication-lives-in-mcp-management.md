# ADR 0007: Notion import authentication lives in MCP management

## Status

Accepted — 2026-09-13.

## Context

Task import is useful before an agent session exists, but its OAuth controls
were only reachable from the task-import modal. That made MCP management look
configured while leaving no visible place to connect the account that Roster
uses to inspect, import, and push task changes.

Notion's hosted MCP is a separate OAuth client. Its `mcp-remote` bridge owns
the agent-facing grant, and hosted-MCP credentials are not copied into Roster
or `mcp.json`.

## Decision

The Notion MCP configuration dialog displays the secure, Roster-owned Notion
connection used for task import. It supports Connect, Reconnect, and
Disconnect without creating an agent session. The existing task-import modal
continues to own database selection, mapping, and import execution.

The credential remains encrypted in the main-process database through
Electron `safeStorage`; renderer IPC exposes status only. Disconnect removes
the credential but preserves saved database mappings, so reconnecting does
not require recreating them.

## Consequences

* A person can authorize Notion from MCP management, then import tasks from
  the board without starting an agent.
* Roster does not falsely present the import credential as the hosted MCP
  bridge's credential. An agent may still complete the bridge's own OAuth
  flow when it first uses hosted Notion MCP.
* Clearing import access makes existing mappings temporarily unusable until
  the person reconnects; it does not destroy those mappings.
