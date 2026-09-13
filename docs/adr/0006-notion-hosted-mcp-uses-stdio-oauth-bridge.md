# ADR 0006: Notion hosted MCP uses a stdio OAuth bridge

## Status

Accepted — 2026-09-13.

## Context

Roster's MCP configuration and runner boundary launch local stdio servers.
Notion's maintained MCP is hosted at `https://mcp.notion.com/mcp`; its
documentation recommends it over the old open-source package and requires an
interactive, user-based OAuth connection. It does not accept bearer-token
authentication for the hosted service.

The prior registry command installed the old `@notionhq/notion-mcp-server`.
That makes people supply and retain an API token in `mcp.json`, while missing
Notion's maintained hosted tools and OAuth flow.

## Decision

The Notion registry entry launches:

```
npx -y mcp-remote https://mcp.notion.com/mcp
```

`mcp-remote` bridges the hosted streamable-HTTP server to the existing stdio
runner contract and completes Notion OAuth in the user's browser. Roster does
not store, forward, or log the hosted-MCP credential. The registry UI tells
users not to add a Notion token to `mcp.json`.

Roster's board-sync OAuth connection remains separate. It is for Roster's
first-party import/push integration, not a credential source for agents.

## Consequences

* Claude and Codex receive the same normal stdio launch specification, so no
  runner-specific remote transport or token plumbing is required.
* The first agent turn using Notion can require a human to complete OAuth in a
  browser; fully unattended Notion-MCP access is intentionally unsupported.
* Existing manually configured Notion commands remain untouched. Reinstalling
  the registry entry is the explicit migration path.
