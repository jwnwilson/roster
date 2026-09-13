# Receive Notion OAuth callbacks on a loopback redirect

## Status

Accepted

## Context

Hosted Notion MCP sign-in redirected to `roster://notion/mcp-oauth`. On macOS
a custom scheme belongs to whichever bundle last called
`setAsDefaultProtocolClient`. A development run is the stock
`node_modules/electron/dist/Electron.app`, so it claimed `roster://` for the
generic Electron bundle: the browser then launched an empty Electron window,
and a packaged Roster could no longer receive its own callback. Even when the
scheme reached a Roster process, it was not necessarily the one holding the
attempt's in-memory OAuth state.

## Decision

Each sign-in opens a one-shot RFC 8252 listener on
`http://127.0.0.1:<ephemeral port>/notion/mcp-oauth` in the main process.
That URL is the attempt's registered redirect. A stored dynamic client
registered for another redirect is re-registered. The listener validates
state, exchanges the code, tells the browser tab the outcome, and closes; it
times out after ten minutes. Roster no longer registers a URL scheme.

## Consequences

Sign-in behaves identically in `npm run dev` and packaged builds, and the
callback always reaches the process that started it. The renderer still
observes only `authStatus`. A local firewall that blocks loopback listeners
would prevent sign-in. This refines
[Use one hosted Notion MCP OAuth connection](2026-09-13-unified-notion-mcp-oauth.md).
