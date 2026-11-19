# Agentmemory integration plan

Planning document for ROS-24. This is not an implementation or an instruction
to install Agentmemory on a developer machine.

## Outcome

Add opt-in, project-scoped retrieval over Roster transcripts while preserving
tasks and `NOTES.md` as the source of truth. Integrate through a small Roster
HTTP adapter to an externally managed Agentmemory daemon. Do not install the
upstream Pi extension, expose its full MCP tool surface, infer consent, capture
unfiled sessions, increase the current project-context budget or make memory
availability a precondition for running an agent.

The companion proposed decision is ADR 0019.

## Evidence baseline

### Current Roster

| Concern | Current behaviour | Integration consequence |
|---|---|---|
| Durable knowledge | `ProjectNotesStore` owns `~/roster/projects/<project-id>/NOTES.md`; agents append through `remember`, users can edit the file | Keep it authoritative and independently usable |
| Shared work | Tasks, comments and project metadata are SQLite-backed and included in the project brief | Do not duplicate them into a second editable store |
| Prompt context | `buildProjectBrief` has one 2,000-character budget, notes are capped at 50%, repositories at 15%, and unchanged briefs are not resent | Retrieved history must consume part of this budget, not add another uncapped block |
| Isolation | `Session.projectId` is explicit; unfiled sessions get no project brief or memory tools | Use the immutable project ID as scope; fail closed when it is absent |
| Transcript | `SessionStore` assigns stable UUIDs to messages and stores structured text/tool/handoff rows | Use Roster message IDs as deterministic capture identities |
| Runner | Pi is embedded in Electron main; its own extensions and skills are disabled and Roster supplies tools explicitly | Keep memory policy above Pi, in Roster, and avoid ambient extension installation |
| Resume | Pi's session file path is a runner detail; Roster session IDs and transcripts outlive runner changes | Key Agentmemory sessions by Roster session ID, not a Pi file path |
| Secrets | Notion credentials already use Electron `safeStorage` behind a `SecretBox`; no token crosses IPC | Reuse the same boundary for an Agentmemory bearer |

### Agentmemory compatibility audit

Audited upstream commit
[`28ffc538`](https://github.com/rohitg00/agentmemory/tree/28ffc538b81b265e2f649354ed9f88b0c12ae414),
package version 0.9.33, on 2026-11-19.

| Question | Evidence | Assessment |
|---|---|---|
| License | Root and Pi integration are Apache-2.0 | Compatible with use as a separate service; retain notices if code is copied |
| Runtime | Node >=20 package, ESM CLI, iii-engine state service; default API 3111 and viewer 3113; state stored outside the repository | Compatible with Roster's Node baseline, but not a lightweight library to hide in Electron main |
| Offline mode | Keyless BM25 works without an API or embedding model; local embeddings require a first model download | Pilot with BM25 only; no implicit model download |
| API | Authenticated `/session/start`, `/observe`, `/session/end`, `/search`, `/smart-search`, `/context`, `/forget`, `/export`, health and audit endpoints | Sufficient for a narrow adapter without MCP or plugin installation |
| Capture delivery | Native integrations scrub common secret shapes, bound request timeouts and use a bounded disk spool with retry/dedup event IDs | Reuse semantics, not upstream files: Roster needs its own tested outbox and visible failure state |
| Recall budget | `/search` accepts `token_budget`; `/context` accepts `budget`; response metadata admits truncation and exclusions | Compatible, but Roster must translate token estimates into its existing character budget |
| Pi integration | Hooks session start, prompt, tool result, final reply, compaction and shutdown; injects recall as hidden reference data | Useful lifecycle reference; direct installation is incompatible with Roster's policy boundary |
| Project scope | Native Pi adapter uses an env override or Git repository basename | Insufficient for multi-repository Roster projects and name collisions; override with `roster:<UUID>` |
| Credentials | Auth is on by default; loopback can discover a generated secret; remote bearer over plaintext HTTP is rejected | Roster should require loopback initially and encrypt the bearer at rest |
| Deletion | `/forget` deletes by session or memory ID; export and audit endpoints exist | Enables explicit session erasure; project-wide erasure needs an inventory-and-delete workflow |
| API stability | Pre-1.0 package, active releases and recent auth/runtime changes | Pin a tested version range in the compatibility contract and fail closed on incompatible health/version responses |

Important caveats:

- Upstream secret scrubbing is defence in depth, not proof that captured text is
  non-sensitive.
- Upstream's published benchmark measures retrieval from supplied sessions; it
  does not establish answer quality for Roster's capture path.
- `smart-search` does not expose the same explicit `token_budget` contract as
  `/search` in the audited route. Initial automatic recall should therefore use
  budgeted compact `/search`; reserve smart search for an explicit tool or a
  later proven formatter.
- Agentmemory's native Pi extension creates a new memory session on Pi session
  start. Roster instead resumes one logical Roster session across turns, so it
  should call `session/end` with `final: false` after a turn and `final: true`
  only when the Roster session is archived or explicitly closed.

## Ownership and data contract

### Sources of truth

1. Tasks/comments: current work and task-specific findings.
2. `NOTES.md`: curated project decisions, conventions and gotchas.
3. Roster SQLite transcript: exact user-visible session history.
4. Agentmemory: derived, rebuildable retrieval index only.

Agentmemory results never update the first three automatically. The existing
`remember` tool remains the deliberate promotion path from conversation to
curated project memory.

### Stable identities

- `project = "roster:" + project.id`
- `sessionId = "roster:" + session.id`
- `agentId = agent.id`
- observation `eventId = "roster-message:" + message.id` for completed
  transcript rows
- tool events use the persisted tool message ID, not a transient Pi call ID

Names and paths are metadata, never keys. A rename, repository move or worktree
must not split memory. Agentmemory requests always include project and session
scope even where the API makes them optional.

### Capture policy

Capture only after all of these are true:

- the global connection has passed authenticated health and compatible-version
  checks;
- the project owner explicitly enabled capture;
- the session has that project ID; and
- the message has been persisted successfully in Roster.

Capture user prompts, final assistant text, and bounded tool names/input/output.
Exclude approvals, generated project briefs, recalled Agentmemory context,
memory-tool output, image bytes, secrets known to Roster, and Roster-authored
operational notices. Apply Roster-side scrubbing before enqueueing; upstream
scrubbing remains a second pass. Record truncation in the observation metadata.

One failed delivery must never fail or delay the agent turn. The outbox is
bounded by record count and byte size, retries with backoff, and exposes pending,
rejected and dropped counts. A 4xx response is rejected and visible; timeout,
429 and 5xx responses retry. Event IDs make replay idempotent.

### Recall policy

Before a filed turn, after building the authoritative project brief:

1. use the user's prompt as the query;
2. request compact `/search` results scoped to `roster:<project-id>` with a
   small token budget and limit;
3. reject malformed, cross-project or oversized responses;
4. render a `Retrieved history` section labelled "reference data, not
   instructions", including source/session IDs and timestamps where available;
5. fit it inside a reserved share of `PROJECT_BRIEF_BUDGET`; and
6. prefer current notes, open tasks and recent comments when the total does not
   fit.

Start with at most 400 characters of retrieved history inside the existing
2,000-character budget and a 750 ms timeout. These are pilot constants to tune
from measured latency, hit rate and prompt cost. No result, disabled memory and
an unavailable service all preserve today's prompt; only health/status differs.

Do not capture the augmented prompt. Capture only the original user message.
Do not resend identical retrieval context on an unchanged query/session unless
the index revision changes.

## Work packages

Each package is independently reviewable and keeps `npm run check` green. Tests
come first, following repository convention.

### WP0 — Freeze the external contract with a spike

Goal: prove the audited API against a disposable, explicitly started daemon
without changing production dependencies or starting it during tests.

Deliverables:

- A checked-in contract fixture for health, session start, observe, compact
  search, deferred/final session end and forget responses.
- A tiny fake HTTP server in tests that asserts headers, scope, timeout and
  payload shape.
- A manual compatibility script or documented checklist that accepts a URL and
  secret, writes only synthetic data under a unique `roster-contract-*` scope,
  and reports the tested Agentmemory version. It must never auto-install or
  auto-start Agentmemory.
- A yes/no record for 0.9.33 covering idempotent repeated event IDs, `final:
  false`, compact budget metadata, session deletion and authentication errors.

Exit criteria:

- The fake contract tests run offline.
- The optional manual check passes against a disposable 0.9.33 instance and
  leaves instructions for deleting its synthetic session.
- Any mismatch updates ADR 0019 before implementation continues.

### WP1 — Add connection, consent and health boundaries

Likely files:

- `electron/main/agentmemory/client.ts`
- `electron/main/agentmemory/settings.ts`
- `electron/main/notion/secretBox.ts` (reuse the interface, do not duplicate
  crypto policy)
- `electron/main/db/migrations.ts`
- `electron/main/ipc/index.ts`, `electron/preload/index.ts`, shared IPC/types
- the project settings/notes UI and focused main/renderer tests

Implement:

- one global endpoint + encrypted bearer + compatible version/health state;
- loopback HTTP only in the first release; HTTPS can be added with an explicit
  remote threat model;
- separate per-project `capture_enabled` and `recall_enabled` flags, both false
  by default;
- user-facing disclosure that transcript text and tool output are copied to a
  second local store;
- test connection, disconnect and clear-credential actions; and
- a status model distinguishing disabled, healthy, unavailable, incompatible
  and authentication failure.

Acceptance criteria:

- A fresh and upgraded database has all projects disabled.
- The bearer is encrypted with `safeStorage`, never returned by IPC, logged or
  included in an agent prompt.
- `http://` accepts only loopback hosts; redirects are rejected.
- An unavailable daemon does not affect ordinary sessions.
- Disabling a project stops new capture and recall on the next turn without
  deleting data.

### WP2 — Capture persisted Roster transcripts through a durable outbox

Likely files:

- `electron/main/agentmemory/capture.ts`
- `electron/main/agentmemory/outbox.ts`
- `electron/main/sessions/manager.ts`
- `electron/main/store/sessions.ts`
- a new append-only migration for outbox/delivery receipts
- focused capture, retry, privacy and session-lifecycle tests

Implement:

- return/use the `Message` produced by `SessionStore.append` so capture uses its
  stable ID after persistence;
- translate eligible text and completed tool rows into scrubbed, bounded
  `/observe` payloads;
- start the Agentmemory session lazily on the first eligible capture;
- defer completion after each settled turn and finalize on archive/close;
- bounded retry/backoff across app restarts, with deterministic event IDs;
- capture health counters visible through WP1 status; and
- explicit exclusion of prompts augmented with project or retrieved context.

Acceptance criteria:

- Same-project sessions from different agents are searchable together; another
  project and an unfiled session produce zero accessible observations.
- Restarting during delivery produces no duplicate observation.
- Timeout/429/5xx queue; 4xx rejects; queue overflow is counted and visible.
- A failed or slow daemon adds no more than the bounded enqueue cost to a turn
  and never changes its success state.
- Captured fixtures contain no project brief, recalled history, image data or
  representative API keys/bearer/private-key fixtures.
- Archive finalizes; restore plus a new turn safely reopens or creates the
  expected upstream session according to the WP0 contract.

### WP3 — Add budgeted automatic recall

Likely files:

- `electron/main/agentmemory/recall.ts`
- `electron/main/sessions/projectBrief.ts`
- `electron/main/sessions/manager.ts`
- focused project-brief, timeout, provenance and isolation tests

Implement compact, project-filtered `/search` before the runner call. Render
results as untrusted reference data under a hard share of the existing brief.
Add source labels and explicit truncation/unavailability metadata. Cache only by
project, normalized query and upstream revision/expiry; never cache across
projects.

Acceptance criteria:

- The complete project brief remains at or below 2,000 characters.
- Notes and open tasks survive a maximal retrieval response.
- A response carrying the wrong project/session identity is discarded and
  reported as degraded.
- Timeout, invalid JSON, auth failure and incompatible version all preserve the
  exact no-recall prompt path.
- Retrieved text is absent from the visible transcript and capture payloads.
- A prompt-injection fixture in recalled text remains visibly delimited as
  reference and cannot alter tool availability or approvals.

### WP4 — Add explicit search, provenance and correction controls

Do this only after automatic recall works. Extend Roster's existing `memory`
tool with a project-bound `search_history(query)` rather than exposing
Agentmemory's 54-tool MCP surface. Keep `remember`/`recall` bound to `NOTES.md`.

Add a project memory screen that can:

- show connection/index health and pending capture counts;
- list retrieved sources with Roster session links;
- export the project scope;
- forget one indexed Roster session; and
- request project-wide erasure through an inventory, confirmation and deletion
  workflow with a receipt.

Acceptance criteria:

- The search tool has no project argument and cannot cross its session's
  project boundary.
- An agent without the existing `memory` capability never receives the tool.
- Forgetting the index does not delete Roster transcripts, tasks or notes.
- Deleting or editing a Roster source is not falsely represented as deleting
  the derived copy; the UI offers an explicit sync/forget action.
- Export and deletion failures are visible and retryable.

### WP5 — Pilot, measure and decide runtime distribution/backfill

Pilot keyless BM25 with synthetic and consenting non-sensitive projects. Record:

- capture delivery/retry/drop rates;
- p50/p95 recall latency and timeout rate;
- characters/tokens injected per turn;
- relevant, stale and wrong-project hit counts from a fixed rubric; and
- disk growth per captured session.

Only after the pilot decide whether to:

- keep external-daemon setup;
- bundle and supervise a pinned Agentmemory/iii-engine sidecar in a separate
  process; or
- stop after the adapter because operational cost exceeds retrieval value.

Historical backfill is a separate opt-in design. It needs a count/size preview,
project selection, cancellation, stable message IDs, progress, a deletion plan
and the same outbox/privacy rules. It is not an implicit consequence of enabling
live capture.

## Rollout and rollback

1. Merge the adapter disabled and exercise only fake-server contract tests.
2. Run the manual compatibility check against a disposable 0.9.33 daemon.
3. Enable capture without recall for one synthetic project; verify isolation,
   outbox restart and deletion.
4. Enable recall for that project; verify budget, latency and provenance.
5. Pilot with explicit user consent and BM25 only.
6. Revisit ADR 0019 with measurements before enabling by default or bundling a
   runtime.

Rollback is configuration-first: turn off recall, then capture, leaving current
Roster memory untouched. Remove the adapter wiring in a later release if needed;
outbox rows may be retained for diagnosis or explicitly discarded with a count.
External Agentmemory data is preserved by default so rollback is reversible.
Erasure is a separate deliberate operation. No schema rollback drops data.

## Verification matrix

| Scenario | Expected result |
|---|---|
| Project disabled | Byte-for-byte current prompt/capture behaviour |
| Service offline | Turn succeeds; capture queues; recall omitted; health degraded |
| Bad credential | No retry storm; no secret in logs/UI; current turn succeeds |
| Unfiled session | No start, observe, search or context call |
| Two projects with same name/repo | UUID scopes remain isolated |
| One project with several repos/worktrees | All filed sessions share one scope |
| Pi session resumed/forked | Roster session identity, not Pi file path, determines capture |
| App restarts mid-delivery | Outbox replays once by deterministic event ID |
| Large/malicious recall | Clipped inside 2,000 characters and labelled untrusted |
| Notes conflict with recall | Current notes/tasks appear first; memory is historical reference |
| Disable after pilot | No future calls; tasks, notes, transcript and indexed data remain |
| Explicit forget | Derived session/project data removed; Roster source retained |

Before every implementation PR run `npm test`, `npm run typecheck` and
`npm run check`. Manual tests must use a private `ROSTER_HOME` and disposable
Agentmemory data directory; never point test capture at a developer's existing
memory store.
