# ADR 0011: ROS-11 requires an explicit Microsoft MCP integration

## Status

Accepted — 2026-10-17.

## Context

ROS-11 asks for Roster agents to read Microsoft Teams, Outlook, and SharePoint
using the person's work account on their machine.

Roster runs Codex through `codex exec` with `--ignore-user-config` and supplies
only the configured **stdio** MCP servers for that agent. It neither embeds
ChatGPT Work nor inherits its workspace plugins. Therefore enabling a Teams,
Outlook, or SharePoint app in ChatGPT does not make it available to a Codex
agent launched by Roster.

The OpenAI Responses API's built-in Microsoft connector IDs also do not solve
this boundary: the application must perform the OAuth flow and provide an
access token, and those IDs are deprecated for models released after 1
September 2026. Roster does not run its agent sessions through that API.

Microsoft documents managed Microsoft 365 MCP servers only for Frontier
tenants in the Azure Foundry/Agent 365 path. Availability, endpoint transport,
and its compatibility with the Codex CLI must be proved before it can be used
by Roster.

## Decision

Do not implement ROS-11 as a ChatGPT plugin enablement or by asking users to
place a Microsoft password, access token, refresh token, client secret, or
exported credential file in Roster configuration.

Treat a maintained Microsoft remote MCP server as the preferred option *only
after* a compatibility spike proves that it supports the required services,
interactive per-user OAuth, and a streamable transport that Roster can bridge
to its stdio runner. The spike must also establish that the tenant is eligible
for the Microsoft offering.

If no maintained compatible server is available, implement a Roster-managed
local stdio MCP bridge over Microsoft Graph. It must use a per-user delegated
OAuth authorization-code flow with PKCE, request only read scopes approved for
the pilot, and retain renewable credentials solely in encrypted OS-backed
storage. MCP tool output must never expose credentials. The bridge exposes
only allowlisted read tools in the initial pilot; sending mail, calendar
updates, Teams posts, and SharePoint writes stay absent.

The implementation must extend the existing MCP-management and runner model;
it must not put connection details in free-form `mcp.json` environment values.
The selected integration owns connect, reconnect, status, and revoke controls,
and Roster must stop serving the tools when authorization is revoked or a token
refresh fails.

## Consequences

* ROS-11 remains **In Progress**; the previous "enable workspace apps" plan is
  not an implementation path for Roster.
* The first deliverable is a bounded compatibility/security spike, followed by
  a design review with the exact server or Graph scopes, token-storage design,
  revocation behavior, and negative-access tests.
* A successful pilot preserves the signed-in user's existing Microsoft access
  boundary. It does not create an application-wide or shared service identity.
* ChatGPT Work plugins may still be useful in ChatGPT, but are explicitly out
  of scope for satisfying Roster's Codex integration.

## References

* [OpenAI MCP servers and legacy connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
* [Microsoft MCP authentication guidance](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/mcp-authentication)
