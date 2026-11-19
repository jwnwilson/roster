# Agentmemory upgrade plan

> Planning deliverable for ROS-24. This document does not authorize installing
> Agentmemory into a user's configuration, capturing real transcripts or
> enabling an external model provider.

**Goal:** Add useful, bounded, project-shared retrieval over consented Roster
sessions without replacing `NOTES.md`, weakening project isolation or making
agent turns depend on a new daemon.

**Recommendation:** Adopt
[ADR 0019](../../adr/0019-agentmemory-is-an-optional-retrieval-index.md):
put an optional Agentmemory sidecar behind a Roster-owned adapter and explicit
project search tool. Keep the existing board, notes and project brief as the
authoritative and offline-safe path. Do not expose Agentmemory MCP directly and
do not ship capture until contract, deletion and packaging gates pass.

**Evidence baseline:** Roster `origin/main` at `6e7071b` and Agentmemory
`v0.9.33` (`28ffc538b81b265e2f649354ed9f88b0c12ae414`). Recheck both before
implementation; Agentmemory is pre-1.0 and its surface can change.

## What exists today

The upgrade is narrower than adding a new memory system:

- `ProjectNotesStore` owns readable, editable
  `~/roster/projects/<project-id>/NOTES.md` files.
- `SessionManager` binds `remember` and `recall` to the current session's
  project. The agent cannot pass a project id.
- `buildProjectBrief` injects repositories, recent notes, tasks and comments
  within a 2,000-character budget and avoids resending an unchanged brief to a
  resumed runner thread.
- Pi receives Roster tools as in-process functions. This is the correct policy
  boundary for a new search tool and capture coordinator.
- Roster persists the user-visible transcript and stable session, project and
  agent ids. Agentmemory should index that state, not become its owner.

Agentmemory v0.9.33 supplies local BM25 search, optional local or remote
embeddings, project/agent filters, budgeted previews, source expansion, REST
authentication, an offline spool and idempotent event ids. It also introduces
a Node 20+ daemon, the `iii` engine and workers, two loopback ports, another
state store, a bearer secret and optional network/model dependencies.

## Alternatives and tradeoffs

| Option | Benefits | Costs and risks | Recommendation |
|---|---|---|---|
| Extend `NOTES.md` and add Roster-native SQLite FTS | Small runtime, simple deletion and offline behavior, fully controlled scope | Only finds curated notes unless Roster also builds capture/ranking/provenance | Keep as fallback if any hard gate fails |
| Roster adapter over Agentmemory REST | Preserves Roster policy, runner-independent, can validate scope and degrade offline | Requires an adapter, outbox, sidecar lifecycle and upstream compatibility tests | Preferred, conditionally |
| Give Agentmemory MCP directly to Pi | Fastest prototype, full upstream tools | Caller-controlled scope, excessive mutation surface, bypasses consent and governance | Reject |
| Replace notes with Agentmemory | One memory backend | Loses editable source of truth; difficult rollback and migration | Reject |
| Import Agentmemory in Electron main | No HTTP hop | Public package entry is worker/CLI; engine lifecycle and failures share Roster's process | Reject for v1 |

## Policy and data contract

### Isolation and sharing

- The storage namespace belongs to one `ROSTER_HOME` and never silently reuses
  global `~/.agentmemory` data.
- Every indexed item carries a Roster project id, agent id, session id, source
  id, source type and capture timestamp.
- Project memory is shared among agents in that project that have Roster's
  `memory` capability. Agent id is provenance, not a private partition.
- Roster binds project and agent ids from the active session. No public tool
  accepts them, no wildcard is sent, and every response is post-filtered.
- Unfiled sessions are never captured or searched.
- Direct Agentmemory MCP, viewer and REST credentials are not exposed to an
  agent. The viewer is not part of the initial product surface.

The filter is defense in depth, not a tenant boundary. A loopback service with
one bearer remains trusted local infrastructure. If Roster later supports
mutually untrusted OS users or remote teams, use separate stores/services and
credentials rather than treating a `project` field as authorization.

### Capture consent and redaction

- Default project policy is `off`. Starting or upgrading Roster performs no
  transcript capture and no historical import.
- Enabling capture shows the data classes and retention policy before writing:
  user prompts, assistant replies, tool names/inputs and bounded tool outputs.
- The project policy and its consent timestamp are durable. Revocation stops
  new capture immediately and offers delete-indexed-data or keep-existing-data.
- Remote LLMs, remote embeddings, Redis, mesh and team sharing stay disabled.
  Local embeddings are a separate opt-in with its download size and source
  shown first.
- Roster applies an allow/deny policy before enqueueing: deny secret/config
  tools and known sensitive fields; replace detected credentials; cap each
  input/output; record that truncation/redaction occurred. Upstream scrubbing
  runs as a second layer.
- Raw content never enters logs, health messages, error telemetry or audit
  metadata.

Initial recommended capture surface:

| Event | Default | Bound |
|---|---|---:|
| User prompt | Included after consent | 4,000 characters |
| Assistant final reply | Included after consent | 4,000 characters |
| Tool name and safe input summary | Included after consent | 1,000 characters |
| Read/search tool output | Excluded initially | 0 |
| Shell output | Excluded initially | 0 |
| Roster memory/task tool result | Metadata only | 500 characters |
| Approval answers, OAuth/login and secret-setting tools | Always excluded | 0 |

The spike may adjust these values from synthetic quality measurements, but
increasing them requires a documented privacy and context-cost reason.

### Provenance, correction and deletion

Roster keeps a local ledger from stable Roster source ids to upstream session,
observation and memory ids. Search results show their Roster provenance and can
open the source transcript. Imported or synthesized records without resolvable
Roster provenance are not returned in the initial integration.

`NOTES.md` remains the correction surface for curated decisions. The first
Agentmemory phase does not mirror notes; it indexes consented transcript events
only, avoiding a dual-write source of truth. `remember` therefore stays exactly
as it is.

Deleting a Roster session or revoking a selected captured item enqueues an
idempotent deletion before removing its ledger mapping. A project purge must
remove sessions, observations, summaries, derived memories, lessons, graph
facts, vector/BM25 entries and offline spool records. The only retained audit
may contain opaque ids, time, actor and reason—never deleted content. If the
pinned upstream release cannot demonstrate that contract, project/session
purge remains a release blocker rather than being described as complete.

Corrections do not mutate old source text invisibly. The source transcript or
note is corrected in Roster, the old indexed lineage is deleted, and a new
version is captured with a supersedes reference in Roster's ledger.

### Bounded recall

The first tool is conceptually:

```text
search_project_memory(query, token_budget?, cursor?)
expand_project_memory(result_ids)
```

The actual implementation may expose one tool with mutually exclusive search
and expansion parameters, matching upstream progressive disclosure. Rules:

- default budget 600 estimated tokens, hard maximum 1,200;
- at most five previews per search and at most five expansions per call;
- previews contain a short excerpt plus source identity and capture time;
- full text is never injected automatically by the search call;
- the adapter rejects returned rows whose project does not exactly match;
- memory content is labelled untrusted evidence and cannot change current
  instructions or authorize a tool call;
- the existing 2,000-character project brief budget does not grow.

Automatic prompt-time retrieval is a later decision. It requires a measured
pilot showing better task outcomes and acceptable false-positive/context cost;
it is not an implied final phase of this plan.

### Offline behavior and rollback

- Daemon health is cached and checked out of the turn's critical path.
- Capture writes a bounded Roster outbox first. The Pi turn proceeds even when
  the daemon is absent, slow or corrupt.
- Stable event ids make replay safe. A deletion tombstone wins over queued
  capture so recovery cannot resurrect deleted content.
- Search failure returns a small unavailable result and the agent continues
  with the project brief, tasks and notes.
- Backoff is bounded; the outbox reports dropped/expired items without storing
  their content in the report.
- Rollback disables the adapter and sidecar. It never rewrites notes, tasks,
  sessions or the project brief. The user chooses whether the isolated index
  directory is retained for a later retry or deleted through the governance
  flow.

## Work packages

Each package is a small PR after this planning PR. Do not combine a failed gate
with downstream implementation in the same PR.

### WP0 — Pin and verify the upstream contract

**Dependencies:** ADR review.

- Pin one released Agentmemory version and record its package, engine and worker
  versions plus checksums.
- Build a synthetic contract harness that starts the daemon in a temporary
  data directory with no provider credentials.
- Exercise health, session start/end, observe, keyless smart search, budgeted
  preview, source expansion, export, session forget, project governance delete
  and restart persistence.
- Attempt caller scope overrides and wildcard reads. Record which upstream
  routes accept them; the adapter must not expose those inputs.
- Trace a unique synthetic marker through every exported collection, indexes,
  graph/lesson/summary state, capture inbox and spool before and after deletion.
- Publish an upstream compatibility matrix and a single supported-version
  constant. Unknown versions fail closed.

**Exit gate:** all API shapes needed by the narrow adapter are stable in the
pinned release, and a complete-delete recipe exists. Otherwise stop and plan
Roster-native FTS.

### WP1 — Prove packaged sidecar lifecycle

**Dependencies:** WP0 contract passes.

- Compare a user-managed test daemon with a Roster-managed child process. Do
  not use `npx @latest` in the application.
- Prove startup, readiness, graceful shutdown, force-kill recovery, crash
  restart, port collision handling, secret generation/rotation and data-dir
  selection under an isolated `ROSTER_HOME`.
- Decide how the signed app ships Node-compatible JavaScript, the pinned `iii`
  executable and registry workers without a user's Node/npm installation or
  a first-launch executable download.
- Build and smoke-test signed/unpacked artifacts on macOS arm64 and x64,
  Windows x64 and supported Linux architecture. Check notarization/signing and
  updater size impact.
- Verify no environment provider key implicitly enables a remote service.

**Exit gate:** a clean offline machine can start Roster and keyless memory from
the packaged artifact, or the feature remains developer-only. If packaging
requires dynamic executable downloads, stop and choose Roster-native FTS.

### WP2 — Add the Roster memory adapter and health seam

**Dependencies:** WP0 and WP1 pass.

- Define transport-free interfaces for notes, capture, search, expansion,
  deletion and health. Keep existing `recall`/`remember` behavior as the notes
  implementation.
- Add an authenticated Agentmemory REST client in Electron main. The renderer
  and Pi runner never receive its URL or secret.
- Bind project/agent/session identity inside `SessionManager`; validate every
  response before converting it to a Pi tool result.
- Add a feature flag/config state that is off for existing and new users.
- Unit-test malformed payloads, timeouts, auth failure, version mismatch,
  cross-project rows and graceful fallback.

**Exit gate:** with the adapter forced down, all existing memory and runner tests
remain byte-for-byte/behaviorally equivalent.

### WP3 — Add consent, policy and the durable outbox

**Dependencies:** WP2.

- Add project capture policy and consent metadata. A schema migration will
  require its own approval under repository policy.
- Add a bounded outbox/ledger/tombstone store with stable event ids and no raw
  content in diagnostic fields.
- Add project settings that explain data classes, local storage, optional model
  downloads, retention, revoke behavior and provider state.
- Implement Roster redaction and capture allow/deny rules as pure functions
  with adversarial fixtures.
- Keep all provider and embedding selectors off; reject remote configuration
  in the initial product surface.

**Exit gate:** no Agentmemory data directory, request or outbox content is
created before explicit project consent.

### WP4 — Capture Roster/Pi sessions

**Dependencies:** WP3.

- Map `SessionManager` lifecycle and normalized Pi events to upstream session
  and observation calls. Do not install upstream hooks or plugins.
- Capture only filed, opted-in project sessions. Preserve stable Roster ids and
  record truncation/redaction metadata.
- Queue before delivery, replay idempotently after outage and prioritize
  tombstones over capture.
- Bound finalization work so ending a turn never waits for summarization or
  consolidation.
- Add synthetic integration tests for restart, duplicate delivery, full
  outbox, expired entries and deletion racing replay.

**Exit gate:** daemon failure adds no user-visible turn failure and no more than
50 ms p95 synchronous overhead in the capture path.

### WP5 — Add explicit project recall

**Dependencies:** WP4 contains searchable synthetic sessions.

- Add the narrow search/expand tool to `memoryTools.ts` and Pi's generated
  built-in definitions; keep raw Agentmemory MCP absent.
- Enforce the budgets and progressive disclosure above.
- Return provenance that links to an accessible Roster session/message.
- Label retrieved text as historical, potentially stale and untrusted.
- Add a deterministic retrieval fixture and compare keyless BM25 with the
  existing project brief and a simple SQLite FTS baseline.

**Exit gate:** on the agreed fixture, keyless recall finds the required source
in the top five for at least 90% of queries, returns zero cross-project markers,
and stays under the hard response budget.

### WP6 — Complete correction, deletion and export controls

**Dependencies:** WP4 ledger and WP5 retrieval.

- Add inspect/correct/forget controls that show exact scope and require
  confirmation for destructive actions.
- Cascade session and project deletion through upstream observations and every
  derived collection identified in WP0; verify by search and export.
- Make revocation stop capture synchronously, then show purge progress and any
  unresolved ids.
- Provide a Roster-owned export of captured items and provenance without
  exposing the upstream bearer or viewer.
- Test interrupted deletes, partial upstream failure, retry, restart and audit
  content minimization.

**Exit gate:** a unique deleted marker is absent from recall, expansion, export,
  derived collections, indexes and spool within five seconds after a successful
  purge; only content-free audit metadata remains.

### WP7 — Opt-in migration and pilot

**Dependencies:** WP6 passes all governance gates.

- Leave all existing notes and transcripts unindexed by default.
- Offer a previewed, cancellable import of selected historical sessions by
  project/date/session. Never infer consent from the project already having
  notes or the agent already having the `memory` tool.
- Resume imports idempotently and honor tombstones.
- Pilot with synthetic data first, then explicitly consented user-selected
  data. Collect local aggregate measures only: query latency, returned count,
  budget use, source expansion, unavailable rate and user-initiated deletion.
- Review false positives, stale results and whether agents actually expand/use
  retrieved evidence before proposing automatic recall.

**Exit gate:** the user can disable the feature and return to notes/brief-only
behavior without migrating or losing any authoritative Roster data.

## Verification matrix

The implementation PRs add focused tests, then run Roster's required gate:

```bash
npm test
npm run typecheck
npm run check
```

Additional measurable acceptance criteria:

| Area | Acceptance criterion |
|---|---|
| Project isolation | 0 foreign-project markers across 100 adversarial search/expand requests, including attempted wildcard and forged ids |
| Agent sharing | Two opted-in agents on one project can find the same shared event; result provenance identifies the originating agent |
| Consent | 0 capture requests, outbox rows or index files before explicit project opt-in |
| Redaction | Seeded API keys, bearer tokens, PEM keys, credential URLs and excluded approval answers are absent from upstream export, spool and logs |
| Recall bound | Maximum 1,200 estimated tokens, five previews and five expansions; project brief remains at 2,000 characters |
| Retrieval quality | Required source in top five for at least 90% of the agreed synthetic queries; report baseline and failures, not only aggregate score |
| Latency | Warm keyless search p95 below 500 ms on the agreed 10,000-observation fixture; capture synchronous overhead p95 below 50 ms |
| Offline | Ten consecutive daemon-down turns complete normally; notes/tasks/brief work; bounded outbox reports overflow without leaking content |
| Replay | Kill/restart during capture yields exactly one upstream event per stable Roster event id |
| Deletion | Successful purge removes the marker from all search/export/derived/spool surfaces within five seconds and cannot be resurrected by replay |
| Packaging | Clean offline launch succeeds on every supported packaged target with no global Node/npm and no executable/model download |
| Rollback | Disabling/removing the adapter leaves notes, tasks, sessions and generated project briefs unchanged |

## Unresolved blockers requiring evidence, not assumption

1. **Complete erasure:** v0.9.33 has separate deletion paths and retains audit
   and some graph history. WP0 must prove or disprove a content-complete purge.
2. **Production packaging:** the daemon depends on `iii` and workers that normal
   setup downloads. Roster must either bundle and sign them or reject the
   managed integration.
3. **Supported API:** Agentmemory has many REST endpoints but no documented
   long-term compatibility guarantee. Pinning plus contract tests is mandatory.
4. **Scope is not authorization:** a single local bearer can access the whole
   store. The Roster adapter must remain the only agent-facing path.
5. **Derived-memory provenance:** upstream synthesis can create rows that no
   longer map cleanly to one Roster source. Initial recall excludes them until
   correction/deletion semantics are proven.
6. **Platform support and app size:** macOS architectures, Windows and Linux
   need a real packaged smoke test; source-level Node compatibility is not
   evidence that Electron distribution works.
7. **Retention:** agree a default TTL and maximum disk budget before WP3. Until
   then, no transcript capture may ship.

## Primary upstream sources

- [Agentmemory v0.9.33 README](https://github.com/rohitg00/agentmemory/blob/v0.9.33/README.md)
- [Recall contract and token budgets](https://github.com/rohitg00/agentmemory/blob/v0.9.33/docs/recall.md)
- [Local runtime, outage and Codex integration notes](https://github.com/rohitg00/agentmemory/blob/v0.9.33/docs/plugins/codex-local.md)
- [State storage and migration](https://github.com/rohitg00/agentmemory/blob/v0.9.33/docs/reliability/state-storage.md)
- [Governance deletion source](https://github.com/rohitg00/agentmemory/blob/v0.9.33/src/functions/governance.ts)
- [Session/observation forget source](https://github.com/rohitg00/agentmemory/blob/v0.9.33/src/functions/remember.ts)
- [Package runtime and Node requirement](https://github.com/rohitg00/agentmemory/blob/v0.9.33/package.json)
- [Apache-2.0 license](https://github.com/rohitg00/agentmemory/blob/v0.9.33/LICENSE)

