# Use one hosted Notion MCP OAuth connection

## Status

Accepted. Its import decision is superseded by [Import Notion tasks one page at a time](2026-09-18-notion-tasks-are-imported-one-page-at-a-time.md); the OAuth decision stands.

## Context

Roster previously had two unrelated Notion authentication paths: a
deployment-configured REST public OAuth client for board import and the
deprecated `notion-mcp-server` process with a static token for agents. The
first cannot work in a packaged build without shipping client configuration;
the second is neither the live hosted Notion MCP service nor a safe place for
per-user OAuth credentials.

## Decision

Roster uses the hosted `https://mcp.notion.com/mcp` service as its sole Notion
connection. The Electron main process owns OAuth discovery, PKCE, dynamic
client registration, refresh and encrypted credential storage. It proxies MCP
requests to agents over a per-turn local socket, and the board importer uses
the same hosted MCP tools through the same authenticated client.

## Consequences

There is one Connect Notion and Disconnect Notion lifecycle. Neither the
renderer, `mcp.json`, agent prompt, child environment, nor SQLite plaintext
contains a Notion bearer token. Existing REST credentials are discarded on
migration and legacy Notion commands are ignored. This supersedes
`2026-09-11-notion-public-oauth.md`.
