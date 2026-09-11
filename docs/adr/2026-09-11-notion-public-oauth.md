# Use public Notion OAuth for desktop connections

## Decision

Roster uses a Notion public OAuth connection for board import and push. Each
user approves access in their browser; the main process exchanges the callback
code and stores its access/refresh credentials encrypted with Electron
`safeStorage`. The renderer never receives a code, bearer token, refresh token,
or client secret.

## Consequences

`NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`, and
`NOTION_OAUTH_REDIRECT_URI` are deployment configuration, not MCP-server
settings. The registered redirect URI is handled by Roster's `roster://`
protocol. Sync remains manual and existing mapping/import semantics do not
change. A 401 causes one refresh attempt, then asks the user to reconnect.

This supersedes the previous decision to read `NOTION_TOKEN` from `mcp.json`.
