# Import Notion tasks one page at a time

## Status

Accepted

## Context

Roster connected a whole Notion database: resolve its data source, read the
schema, guess a mapping for the user to correct, then import every row. It did
not work. The adapter sent Notion REST API shapes — `{status: {name}}`,
`{title: [{plain_text}]}` — to the hosted MCP tools, which take flat property
values, so imports read nothing back and pushes wrote nothing. The machinery
that produced this was also far larger than the thing people actually do,
which is to work on one task they can already point at.

## Decision

A Notion page is put on the board by its link. Roster reads the page, creates
a task with the matching status, and keeps the page link in the task
description, where markdown already renders it and opens it externally.
Importing the same link twice returns the task that exists.

Status moves and comments on an imported task are written to its Notion page.
Roster never reads Notion back: a page edited in Notion simply follows the
board the next time the card moves. Priority, title and assignee are not
pushed.

What each Roster status is called in Notion is one map for the workspace,
edited in the Notion modal and stored in `notion_settings`. Roster has five
statuses and a Notion board usually has three, so several Roster statuses may
share a Notion name. The schema is never read, so the property written is
`Status`, the name Notion's own template uses.

## Consequences

Connecting a database, the mapping editor, the property detection, the REST
client and the per-database connection store are gone. The retired
`notion_connections` table stays in place, unread: it holds the page ids of
anything imported before this, and tasks imported that way keep syncing.

A failure — a page Roster cannot see, a status name the board does not have —
appears as a comment on the task, because there is no notification surface and
a silent failure would leave Notion quietly wrong.

This supersedes the import parts of
[Use one hosted Notion MCP OAuth connection](2026-09-13-unified-notion-mcp-oauth.md).
The OAuth decision there still holds.
