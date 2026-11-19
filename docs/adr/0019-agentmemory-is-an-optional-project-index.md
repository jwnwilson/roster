# ADR 0019: Agentmemory is an optional project-scoped transcript index

## Status

Proposed — 2026-11-19

## Context

Roster already has two kinds of project memory:

- authoritative shared state in tasks, comments and project `NOTES.md`; and
- a compact project brief, capped at 2,000 characters and prepended to a turn
  only when its session is filed under a project.

The earlier project-memory design deliberately deferred transcript retrieval.
It rejected making opaque indexed storage the source of truth, adding an
embedding dependency to the base app, and injecting unbounded history. Those
constraints still hold. The question is whether Agentmemory can add retrieval
over conclusions that nobody promoted to a task comment or note without
replacing the memory users can inspect and edit.

Agentmemory 0.9.33 is an Apache-2.0 Node 20+ service backed by iii-engine. Its
authenticated HTTP API supports project-scoped session lifecycle, observation
capture, budgeted context/search, export and deletion. Keyless BM25 retrieval
works without a model API; local embeddings and LLM compression are optional.
Its native Pi integration captures prompts, tool results and replies, queues
failed deliveries, and injects recall as reference data.

That native Pi integration is not the right ownership boundary for Roster. It
derives project scope from a repository basename, while Roster projects have
stable UUIDs and may contain several repositories. It also installs extensions
and skills into Pi's agent directory, whereas `PiRunner` intentionally disables
ambient Pi extensions and skills and supplies only Roster-selected resources.

## Decision

Adopt Agentmemory only as an **optional derived index of project-filed Roster
transcripts**, behind a Roster-owned adapter to its versioned HTTP API.

- Tasks, comments and `NOTES.md` remain authoritative. Existing `remember` and
  `recall` continue to operate on `NOTES.md`; Agentmemory does not rewrite or
  compact that file.
- Roster project IDs define isolation. The external scope is
  `roster:<project-id>`, independent of project names, repositories, worktrees
  and agent identities. Sessions without a project are never captured or
  recalled.
- Capture and recall are opt-in per project, with a separate global connection
  state. Enabling an agent's existing `memory` tools does not imply consent to
  transcript capture.
- Roster translates its own persisted messages and runner events into
  Agentmemory observations. It does not import Pi session files or install the
  upstream Pi extension, hooks, MCP server or skills.
- Recall is reference data, never instructions. It shares the existing project
  context budget rather than increasing it, names omissions explicitly, and
  is not written into Roster's visible transcript or sent back into capture.
- The first supported runtime is an externally managed, loopback Agentmemory
  daemon. Roster stores any bearer using Electron `safeStorage`, rejects remote
  plaintext HTTP and never exposes the secret to the renderer or an agent.
  Bundling or supervising the iii-engine runtime is a later distribution
  decision, not part of the adapter.
- Capture is asynchronous, idempotent and fail-open for the coding turn. A
  bounded durable outbox records delivery state and exposes degraded health;
  retrieval has a short timeout and absence is reported as unavailable rather
  than "no memories".
- Disabling the adapter immediately restores today's prompt and capture paths.
  It does not delete indexed data. Forgetting a Roster session or project is a
  separate explicit action, and deletion receipts are retained locally.

## Consequences

Roster gains cross-session retrieval without making Agentmemory a required
dependency or a second editable source of project truth. The adapter is usable
in keyless BM25 mode and does not require paid model calls. Agentmemory can be
upgraded or replaced behind the boundary, and an outage cannot block a turn.

Transcript capture creates a second local copy of potentially sensitive text.
Secret scrubbing reduces accidental credential retention but is not a privacy
boundary, so setup must explain what is captured and projects start disabled.
Users need health, export, forget and retry controls before automatic capture
can be considered complete.

Retrieval quality is probabilistic and stale results remain possible. Recalled
text is therefore labelled with provenance, treated as untrusted reference
data and kept below current tasks and notes in the prompt hierarchy. Current
code still wins when it conflicts with memory.

The external daemon is an operational dependency for enabled projects. Roster
must test API compatibility and surface version/health failures. No automatic
download, npm installation, process supervision, model download or data
migration occurs in the first release.

## Rejected alternatives

**Replace `NOTES.md` with Agentmemory.** This loses the plain-file, user-owned
memory model and makes an index the source of truth.

**Install Agentmemory's native Pi integration.** Its lifecycle hooks are useful
evidence for the adapter, but repository-derived scoping, ambient skills and
direct prompt injection bypass Roster's project, consent and budget policies.

**Embed Agentmemory in Electron's main process.** Agentmemory is designed as a
server with its own engine, state and optional model runtime. Embedding it would
couple Roster's availability and release package to that stack and make rollback
harder.

**Capture every Roster session.** Unfiled sessions have no durable owner or
isolation boundary. Global memory was explicitly excluded by the original
project-memory design.

**Backfill all existing transcripts on enable.** Consent cannot be inferred
retroactively, and a large import obscures whether live capture works. A later
explicit, previewed backfill can be designed from evidence gathered in the
pilot.

## Evidence

- Roster's original boundary and deferred transcript search:
  `docs/superpowers/specs/2026-08-28-project-memory.md`.
- Current notes, prompt budget and Pi ownership:
  `electron/main/store/projectNotes.ts`,
  `electron/main/sessions/projectBrief.ts`,
  `electron/main/sessions/manager.ts`,
  `electron/main/runners/pi/runner.ts`, and ADR 0017.
- Upstream audited at
  [`rohitg00/agentmemory@28ffc538`](https://github.com/rohitg00/agentmemory/tree/28ffc538b81b265e2f649354ed9f88b0c12ae414):
  [package/runtime and license](https://github.com/rohitg00/agentmemory/blob/28ffc538b81b265e2f649354ed9f88b0c12ae414/package.json),
  [Pi lifecycle adapter](https://github.com/rohitg00/agentmemory/blob/28ffc538b81b265e2f649354ed9f88b0c12ae414/integrations/pi/index.ts),
  [budgeted recall contract](https://github.com/rohitg00/agentmemory/blob/28ffc538b81b265e2f649354ed9f88b0c12ae414/docs/recall.md), and
  [Apache-2.0 license](https://github.com/rohitg00/agentmemory/blob/28ffc538b81b265e2f649354ed9f88b0c12ae414/LICENSE).
