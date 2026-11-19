# ADR 0019: Agentmemory is an optional retrieval index

## Status

Proposed — 2026-11-19. Implementation is gated on the contract and packaging
spikes in the accompanying plan.

## Context

Roster already has two kinds of project memory:

- the task board and `~/roster/projects/<project-id>/NOTES.md` are durable,
  user-visible project state;
- `SessionManager` prepends a bounded project brief and gives opted-in agents
  project-bound `recall` and `remember` tools.

The earlier project-memory design rejected transcript retrieval because it
would add an embedding model, vector store, runtime dependency and noisy
automatic context. That was the right decision for the feature as then
defined. Roster now has a single Pi runner path, stable session/project/agent
identities and in-process built-in tools, so it can add retrieval without
giving a third party control of a runner or replacing its curated memory.

[Agentmemory v0.9.33](https://github.com/rohitg00/agentmemory/tree/v0.9.33)
is an Apache-2.0 local daemon for captured agent sessions. It provides
authenticated REST and MCP APIs, BM25 recall without model credentials,
optional embeddings and LLM consolidation, bounded recall, provenance,
offline capture replay and deletion operations. It requires Node.js 20 or
newer and a pinned `iii` engine. The published package is pre-1.0 and exposes
the worker/CLI rather than a stable embeddable storage library.

Important limits affect the integration:

- upstream explicitly describes project metadata as a retrieval aid rather
  than an account or tenant authorization boundary;
- callers can supply or override `project` and `agentId`, including wildcard
  agent reads;
- deletion is split across session/observation forget, memory governance,
  lessons and other derived collections; deleting a memory does not prove a
  whole captured session or project has been erased;
- the complete runtime starts a daemon and engine, may fetch registry workers,
  and local embeddings download model weights on first use;
- remote embedding or LLM providers receive the text they process.

Those are acceptable properties for an internal component only if Roster owns
the boundary, lifecycle and user policy around it. They are not acceptable as
an agent-facing MCP server with caller-selected scope.

## Decision

Keep `NOTES.md` and the board as Roster's authoritative, human-correctable
project memory. Introduce a Roster-owned memory adapter seam, with the current
notes implementation as the required baseline and Agentmemory as an optional
local retrieval index behind it.

Roster will not expose Agentmemory's MCP tools, bearer secret or raw REST API
to agents. `SessionManager` will continue to construct in-process tools and
bind project and agent identity from the active session. The adapter will add
only the narrow operations Roster supports, initially:

- capture an opted-in session event with Roster provenance;
- search one project within a caller-supplied token budget;
- expand a selected result to its source;
- delete or correct records through Roster's own governance workflow;
- report health without making a turn depend on the daemon.

Every adapter request must supply the session's project id and agent id, reject
wildcards, validate the scope of every returned row and fail closed on a scope
mismatch. Project-shared recall is the product policy: agent identity is
provenance, not a private-memory partition. An agent still needs Roster's
`memory` capability to search or save. Cross-project recall is never offered.

Automatic transcript capture is off by default. It requires project-level,
explicit user consent after showing what is stored: prompts, assistant replies,
tool names/inputs and bounded outputs. Roster redacts and bounds content before
it reaches Agentmemory; upstream secret scrubbing is a second layer, not the
policy boundary. Remote LLMs, remote embeddings, team sharing and remote Redis
remain disabled. Local embeddings are a separate opt-in because their first
use downloads weights.

The first retrieval surface is an explicit, progressively disclosed project
search tool. Results include source type, agent, session, capture time and a
Roster source identifier. Search returns previews within a hard token budget;
full content is fetched only for selected result ids. Agentmemory results are
evidence, never instructions. The existing project brief remains the automatic
baseline. Automatic transcript recall at turn start is deferred until an
opt-in pilot demonstrates useful recall without unacceptable noise, latency or
context cost.

Roster owns a bounded, durable outbox with stable event ids for capture and
deletion. A daemon outage must not block or fail a Pi turn. `NOTES.md`, the
board and the existing brief continue to work while Agentmemory is absent or
disabled. Replay is idempotent and respects deletion tombstones so migration
or recovery cannot resurrect erased content.

There is no historical transcript backfill by default. Existing notes remain
unchanged. A later import may index selected existing sessions only after the
user previews the scope, consents and chooses a date/session range. The first
implementation must not send real transcripts to an external provider.

Agentmemory is not shipped as a production dependency until a packaging spike
proves a pinned release can run in signed Roster builds on every supported
platform without relying on a user's global Node/npm configuration. Until then,
the adapter may be exercised only against an explicitly configured local test
daemon with synthetic data.

## Consequences

The old decision changes narrowly: transcript retrieval is no longer rejected
outright, but automatic capture and injection are not accepted by default.
Roster gains an experimental, consented and bounded retrieval path while
preserving the inspectable memory that already works.

The adapter adds code and state that a direct MCP connection would avoid, but
it is where project isolation, consent, redaction, provenance, deletion and
offline behavior can actually be enforced. It also prevents Pi, future runners
and Agentmemory's 54-tool surface from becoming coupled.

`NOTES.md` remains useful if Agentmemory is removed. Rollback disables capture
and search, drains or discards only the retrieval index according to user
choice, and leaves notes, tasks, sessions and the project brief intact.

The integration must stop before production rollout if the pinned upstream
release cannot prove complete project/session deletion, cannot be packaged
without unreviewed downloads, or returns cross-project data under adversarial
scope tests. In that case Roster should extend its existing notes and SQLite
search instead of weakening the boundary.

## Alternatives considered

**Extend `NOTES.md` only.** Add correction metadata, compaction and local search
without a new runtime. This is the fallback and the lowest-risk option, but it
still depends on agents deliberately recording conclusions and cannot recover
useful history that nobody curated.

**Expose Agentmemory MCP directly to Pi.** This is the quickest demo and is
rejected. An agent could choose another project or wildcard agent scope, use
unreviewed mutation/team tools, and bypass Roster's consent and deletion flow.

**Replace notes with Agentmemory.** Rejected. The user would lose the simple,
editable source of truth and rollback would become a data migration.

**Embed the npm package in the Electron main process.** Not currently a
supported integration: the package's public entry point is its worker/CLI and
it brings the `iii` runtime lifecycle into Roster's process. A supervised
sidecar is the only packaging option to evaluate.

**Build Roster-native transcript search now.** SQLite FTS would fit Roster's
runtime and deletion model better, but would duplicate capture, ranking,
provenance and evaluation work before the Agentmemory contract has been tested.
It remains the fallback if the contract or packaging gates fail.

## Evidence reviewed

- Roster's prior decision:
  `docs/superpowers/specs/2026-08-28-project-memory.md`
- Current Roster integration points:
  `electron/main/sessions/projectBrief.ts`,
  `electron/main/store/projectNotes.ts`,
  `electron/main/runners/memoryTools.ts`,
  `electron/main/sessions/manager.ts` and
  `electron/main/runners/pi/runner.ts`
- [Agentmemory v0.9.33 README](https://github.com/rohitg00/agentmemory/blob/v0.9.33/README.md)
- [Recall and context-budget contract](https://github.com/rohitg00/agentmemory/blob/v0.9.33/docs/recall.md)
- [Codex/local runtime and failure behavior](https://github.com/rohitg00/agentmemory/blob/v0.9.33/docs/plugins/codex-local.md)
- [Governance deletion implementation](https://github.com/rohitg00/agentmemory/blob/v0.9.33/src/functions/governance.ts)
- [Session and observation forget implementation](https://github.com/rohitg00/agentmemory/blob/v0.9.33/src/functions/remember.ts)
- [Runtime package metadata](https://github.com/rohitg00/agentmemory/blob/v0.9.33/package.json)
- [Apache-2.0 license](https://github.com/rohitg00/agentmemory/blob/v0.9.33/LICENSE)

