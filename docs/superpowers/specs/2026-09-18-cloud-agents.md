# Cloud agents — running a turn where Roster is not

**Status:** plan, not an implementation
**Date:** 2026-09-18
**Verified against:** `main` at `31093f0`

A plan for running an agent in a container so it keeps working while the
desktop app is closed, managed from the same UI, on the same code.

---

## 0. Two modes

An agent runs in one of two modes.

**Local** is exactly what exists today, unchanged in every respect: the turn
runs inside the Electron main process, on the user's own logged-in CLI,
against `~/roster/roster.db`. No network, no backend, no behaviour change. If
this spec causes a single observable difference to a local agent, it is wrong.

**Cloud** runs the agent's turns in a container. A backend is authoritative
for that agent's sessions, so a turn continues when the desktop app is closed,
and Roster reads the record when it next opens.

This replaces an earlier framing in which a hosted backend owned everything.
That framing cannot be built here and should not be attempted: `SessionManager`
takes five concrete store classes rather than interfaces
(`electron/main/sessions/manager.ts:153-179`), all constructed from one
`better-sqlite3` handle (`electron/main/ipc/index.ts:217-233`), and the
codebase has already considered a second writer on that file and rejected it —
`McpBridge`'s own doc comment says the hollow child exists because the
alternative *"would put a second writer on a `better-sqlite3` database whose
only writer today is this process"* (`electron/main/runners/mcpBridge.ts:26-33`).
Making the backend authoritative for local work would also mean Roster shows
nothing without a network, including for work that has never touched the
cloud.

Two modes keep local-first intact and make the cloud additive. The cost is
that "where does this session run" becomes a real concept in the UI, and a
session cannot migrate between modes mid-life (§5.5).

---

## 1. What this reverses

Three accepted decisions say the opposite of what this spec proposes. They
were right for a single-process desktop app; they are what a cloud mode has to
change, and they must be superseded rather than quietly contradicted.

- `docs/adr/0005-session-liveness-nudges.md` — *"the runner cannot survive the
  process that owned it"*, the monitor *"is not a background daemon"*, and
  *"Roster does not need a separate scheduler process; closing the app stops
  checks."*
- `electron/main/store/sessions.ts:255-257` — `recoverInterruptedRuns()`
  blanket-resets every `running` session to `done` at startup, commented *"No
  runner survives an app restart, so a persisted running state is stale."*
- `docs/adr/2026-09-13-notion-oauth-loopback-redirect.md` — the entire
  rationale for the loopback redirect is that *"the callback always reaches the
  process that started it."*

The companion ADR (`docs/adr/2026-09-18-agents-may-outlive-the-app.md`) records
the reversal and scopes it to cloud mode.

---

## 2. What is true today

Evidence first. Everything in this section is cited and was checked against
the tree, because the design in §3 only makes sense against it.

### 2.1 Electron is already confined to three files

`electron/main/index.ts`, `electron/main/ipc/index.ts` and
`electron/preload/index.ts` hold every `electron` import in the main process.
`runners/claude.ts` imports none. This is why an engine extraction is
plausible at all rather than a rewrite.

### 2.2 The engine is welded to its storage

`SessionManager` is constructed with concrete store classes
(`sessions/manager.ts:153-179`). Beyond SQLite there are **five file-backed
stores**, and they are not rows: agents (`~/roster/agents/<id>/agent.toml`),
skills (real folders, some of them symlinks to elsewhere on the user's disk),
`mcp.json`, `projects/<id>/NOTES.md`, and plan bodies
(`plans/<id>/v<N>.md`). Three run `fs.watch` and broadcast on change
(`ipc/index.ts:284-292`). Any backend that serves a cloud agent needs a
substrate for these, not just for tables.

### 2.3 A turn's live state is five unserialisable fields

`ActiveRun` (`sessions/manager.ts:106-130`) holds an `AbortController`, a
timer, a `Promise`, a `finish` closure and a map of decision resolvers. The
rest — `toolMessages`, `approvals`, `pendingText` — is plain data that is
never written anywhere.

### 2.4 An `approvals` table has existed since migration 1, and nothing uses it

`db/migrations.ts:33-43` creates `approvals` with `status`, `created_at`,
`decided_at` and an `ix_approvals_pending` index. No store reads or writes it.
`Approval.status` and `Approval.decidedAt` (`shared/types.ts:214-216`) are
correspondingly dead fields. The schema anticipated durable approvals; the
implementation never arrived. That table is where a parked decision belongs
(§4.1).

### 2.5 `PlanFlow` already parks — in memory, for one process lifetime

`PlanFlow.approve` denies the blocked `ExitPlanMode` with a reason and
enqueues the build as its own turn (`sessions/planFlow.ts:119-129`), because
*"the build cannot happen inside the planning turn — plan mode refuses every
edit for its whole life."* The new turn resumes the CLI thread, since `send`
passes `resumeFrom: session.runnerSessionId` (`manager.ts:448`).

Three things about it do not survive a restart, and they are bugs today:

1. **A deny does not end the turn.** `respondToApproval` resolves the SDK's
   `canUseTool` promise with `{ behavior: 'deny', message }`
   (`runners/claude.ts:186-188`); the agent reads the refusal and continues in
   the same turn. `enqueue` then sees an active run and queues
   (`manager.ts:334-338`), and the queued turn starts only in `drain`, at the
   end of `send`'s `finally` (`manager.ts:488`). The whole shape depends on the
   process staying alive across both turns.
2. **Nothing is persisted.** `blockedOnPlan` reads `pendingApprovals`
   (`planFlow.ts:146-152`), which reads `this.active` in memory
   (`manager.ts:831-833`). After a restart it is `null` and `submit` silently
   takes the other branch — the same user action producing different agent
   behaviour depending on whether the process bounced.
3. **`queued` is a `Map`** (`manager.ts:143`). An approved plan's build turn
   dies with the process, and because `approve` sets `building` *after*
   enqueueing (`planFlow.ts:127-129`), the plan is left marked `building` with
   no turn behind it and no UI affordance to recover it.

### 2.6 Where resume state actually lives

`Session.runnerSessionId` is an opaque handle into the CLI's own local state.

- **Claude:** `~/.claude/projects/<slug-of-the-absolute-cwd>/<session-id>.jsonl`.
  The directory name is the working directory with its slashes replaced by
  dashes, so the *path itself* is part of the key.
- **Codex:** `~/.codex` (sqlite plus `history.jsonl`), and a Codex session is
  additionally pinned to the directory of its first turn for life — its
  working directory *"is inherited from the stored session"*
  (`runners/codex.ts:99-101`).

So resume needs both the CLI's transcript state **and** the identical absolute
cwd. This is the hardest constraint in the whole plan (§5).

### 2.7 The Agent SDK spawns a native binary

"The Agent SDK runs in-process" is true only of the MCP servers
(`inProcessMcpServers`, `manager.ts:421`), which the SDK bridges over its own
control stream. The SDK itself spawns a per-platform native executable —
`pathToClaudeCodeExecutable`, `executable`, `executableArgs` in its type
definitions, and eight per-platform optional dependencies including
`linux-x64` and `linux-arm64-musl`.

`build/afterPack.cjs` exists because of exactly this, and documents the
failure mode: *"a wrong-arch bundle is only detectable at runtime, on the
user's machine."* v0.1.28 shipped arm64 DMGs holding x64 binaries. A container
image must install for `linux/<arch>` or the first turn dies with "native CLI
binary not found".

### 2.8 Codex already has no per-tool gate

`CodexRunner.respondToApproval` is a documented no-op
(`runners/codex.ts:144-148`); Codex gates through its own sandbox. So the
decision to drop the per-tool gate in cloud mode is a change for **Claude
only**.

---

## 3. Design

### 3.1 Mode is a property of the agent

`agent.toml` gains a mode. Local is the default and the absence of the field.
Cloud names the deployment that runs it.

Everything about a local agent stays where it is. A cloud agent's sessions,
messages, usage and approvals are owned by the backend; Roster reads them and
renders them beside local ones, labelled with where they run.

### 3.2 Split execution from state

The extraction is not "everything that is not Electron". It is two layers:

- **The turn executor** — `SessionManager.send`, the runners, `McpBridge`, the
  built-in tool servers. Must be co-located with the workspace and the CLI's
  own state. Runs unchanged in Electron main *and* in a container. This is
  what makes "identical logic" a fact rather than a claim.
- **The stores** — behind repository interfaces. `SessionManager` should take
  `SessionRepository`, `PlanRepository`, `TaskRepository`, `UsageRepository`,
  `AgentRepository` and `NotesRepository`. The existing classes satisfy them
  unchanged; a `Remote*` implementation talks to the backend.

### 3.3 Split the contract, do not swap the transport

`shared/ipc.ts` is genuinely JSON-clean — no functions, no class instances, no
Buffers (`SecretBox` base64s before anything reaches a payload,
`ipc/index.ts:180`). But it is a *capability surface*, not a wire protocol, and
it splits into two:

**`RosterShellApi` — always local, never remote.** `window.*` chrome, the
whole `update.*` namespace (it updates the desktop app, and `update.install`
calls `shell.openPath`), `dialog.chooseDirectory`, `skills.reveal`
(`shell.showItemInFolder`), and the browser handoff in `notion.beginAuth`
(`shell.openExternal` — on a remote engine the browser that opens is the
container's).

**`RosterEngineApi` — remote-capable.** Everything else, with these payloads
fixed:

| Payload | Problem | Change |
|---|---|---|
| `skills.read/write(path)` (`ipc.ts:111-112`) | Renderer passes an absolute path; the only defence is `SkillStore.confine` | Take `(skillName, relativePath)` so confinement is structural, not a string check |
| `skills.link(directory)` (`ipc.ts:118`) | Symlinks a folder from the *user's* machine | Shell-only; a cloud agent's skills come from the backend library |
| `Agent.cwd` / `cwdLabel` (`types.ts:56-58`) | Absolute, `~`-expanded against `homedir()` | See §5.6 — must stop being the answer to "where does work happen" |
| `RunnerStatus.path` (`types.ts:35`) | Absolute path to a CLI binary | Engine-side detail; not in the client contract |
| `McpServer.env` (`types.ts:402-407`) | **Carries raw tokens, and `mcp.list()` returns them to every client** | `list` returns key names and a set/not-set flag; `save` is write-only |
| `pty.*` (`ipc.ts:102`) | An interactive shell with the CLI token in its environment | §8 — off by default in cloud, granted explicitly |

### 3.4 The guarantees the network takes away

Electron IPC gives exactly-once, in-order, same-lifetime delivery for free. A
socket gives none of it, and the contract has nothing to replace them:
`CHANNELS` is a flat list of strings with no version, and
`SessionEventPayload` (`ipc.ts:370-379`) has no sequence number, so a
reconnecting client cannot know what it missed. `message-updated` is a
whole-message replace, so one dropped frame leaves stale text on screen until
a reload.

Needed: a monotonic `seq` per session, `subscribe(since)`, a protocol version
in the handshake, and refusal of a client older than the engine — the posture
`migrate()` already takes for the database (`db/index.ts:37-46`).

There is also a latent bug that only latency will expose: `src/App.tsx:71-75`
fires `void load()` then synchronously subscribes, and `hydrate` overwrites
anything that arrived in the window. Sub-millisecond locally. And there is no
reconnect at all — the unsubscribes run only on unmount
(`App.tsx:106-113`), so a dropped socket stops every event while the UI still
looks alive.

### 3.5 Authorisation, which does not exist yet

Three doc comments state an invariant — *"so a caller in the renderer cannot
skip it"* (`ipc.ts:73-76`, `:127-130`, `:185-188`) — enforced by
`confirmDelete`, a **native modal** (`ipc/index.ts:668-689`). Over a network
that modal renders on the engine host, i.e. nowhere, and
`dialog.showMessageBox` with no window would block a headless process forever.

Read honestly: Roster has no authorisation model. It has a UX guard that
happens to live on the privileged side, and that sufficed because
`contextIsolation: true` plus one local user was the whole trust boundary.
Adding `{ confirmed: true }` to the payload reproduces precisely the
skippability the comment was written to prevent.

Two separate replacements:

- **Confirmation is a client concern.** Move the dialog to the renderer.
  Nothing is lost; it lived in main for proximity to privilege, not
  correctness.
- **Authorisation is an engine concern.** For destructive verbs, make it
  non-forgeable rather than declarative: `prepareDelete(id) → { token,
  expiresAt, summary }`, then `commitDelete(id, token)`. The token binds a
  confirmation to one object, one principal, one moment.

---

## 4. Parking that survives the process

A cloud session parks only on a genuine decision — `ExitPlanMode`,
`request_user_decision`, or questions — and waits indefinitely. There is no
per-tool gate; the container's isolation is the safety boundary.

**But `canUseTool` must stay installed.** `ExitPlanMode`'s plan body arrives
*through* the approval path (`runners/claude.ts:179`, `manager.ts:793`), and
`raiseApproval` is what captures the plan. Removing the callback would
silently remove plan capture. Ungating means it returns `allow` by default,
with these three still routed through it.

### 4.1 Persist the decision

Use the `approvals` table from §2.4, adding `questions` (JSON) and `plan_id`.
`pendingApprovals` reads the table rather than `this.active` — which also
fixes the desktop bug where an approval vanishes if Roster restarts mid-turn.

### 4.2 Two mechanisms, not one

| Kind | Mechanism | Why |
|---|---|---|
| `ExitPlanMode` | **Deny with reason** — `PlanFlow`'s existing shape | Here "stop planning, and here is why" really is the semantics |
| Questions | **Suspend** — persist, abort the turn, re-pose on resume | `withAnswers` merges answers into the blocked tool's own input (`claude.ts:221-227`); a deny has no channel for answers, only a reason, and `{ approved: false }` makes `completeDecisionTool` write `isError: true` (`manager.ts:1078-1079`) |
| `request_user_decision` | **Suspend** | A denied decision returns literally *"The user declined to make that decision."* with `isError: true` (`runners/handoffTool.ts:208-213`) — it tells the model the user refused, which is the opposite of "wait for me" |

Parking by denial would be a different conversation, not identical logic: the
model is told it was refused, gives up or guesses, and the answer arrives as
prose in a later turn after the fact.

Resume must inherit `blockedOnPlan`'s discipline — match on the **specific
decision**, never "whatever approval is pending", because *"answering a
blocked Bash call with plan notes would run the command"*
(`planFlow.ts:143-152`).

### 4.3 Supporting changes

1. `queued` becomes a durable table, not a `Map`.
2. `PlanFlow.approve` sets `building` **before** enqueueing, or both in one
   transaction — today the ordering is a crash window (§2.5).
3. `recoverInterruptedRuns` stops flipping `running → done` blindly. A session
   with a persisted pending approval recovers to `approval`; one with a durable
   queued turn recovers to `running` and is re-dispatched; the rest become
   `done` **with a transcript row** saying the turn was interrupted, rather
   than silently presenting a crashed turn as a completed one.

### 4.4 The test that is the whole thesis

Run a turn to a question, **destroy the engine object**, build a fresh one over
the same database, answer, and assert the agent received the answer. If that
passes, parking survives a process boundary. It can be written and run on the
desktop today, before any container exists.

---

## 5. Continuation across machines

### 5.1 The problem

A CLI conversation is a local file the CLI owns, and Roster has no name for it
that survives the machine (§2.6). Even with a perfect transcript, the agent's
**working tree** must also be there — same paths, same uncommitted work.

### 5.2 One asymmetry in Roster's favour

Claude's SDK already has an external session store: `Options.sessionStore`,
marked alpha, whose `load(key)` is *"called once, in the SDK parent, before
subprocess spawn. The result is materialized to a temporary JSONL file; the
subprocess resumes from that file using its existing resume code."* Its
`SessionKey.projectKey` is documented as *"caller-defined scope … multi-tenant
deployments should set this to a tenant ID or project name"*, and
`importSessionToStore(sessionId, store)` copies an existing local JSONL into
it — which is exactly the desktop→cloud migration primitive.

Codex has no equivalent.

### 5.3 Options

| | Approach | Claude | Codex | Scale to zero |
|---|---|---|---|---|
| A | Implement `SessionStore` over the backend | yes (alpha) | no | yes |
| B | Session-pinned pod + volume holding `~/.claude`, `~/.codex`, workspace | yes | yes | no |
| C | Snapshot/restore that state at turn boundaries | yes | yes | yes |
| D | Abandon CLI resume; replay Roster's transcript as context | yes | yes | yes |

**D is rejected.** It reimplements context management, which the founding
design forbids — *"Roster does not implement an agent loop … the CLI owns all
of it."* It also destroys prompt caching (every turn re-pays for the whole
history) and drops everything not in Roster's transcript: todo state,
compaction, subagent transcripts.

**Recommendation: B first, C as a later cost optimisation, A as a Claude fast
path once the alpha settles.**

### 5.4 Scale-to-zero is not a parking property

It is a consequence of externalised state, and it belongs in a later phase.
Pin the pod with an idle timeout of around thirty minutes, so the common case
— the user answers within minutes — never exercises restore at all, and
restore is first exercised at a boundary that was chosen rather than stumbled
into.

### 5.5 A session does not change mode

Because resume is keyed to both CLI state and an absolute path, a session
cannot move between local and cloud mid-life without losing its thread. Mode
is chosen per agent, and a session inherits it at creation.

### 5.6 The workspace is the other half

`Agent.cwd` is currently the only answer to "where does this work happen",
consumed at `manager.ts:410`. A session whose location is "whatever directory
the agent happens to sit in" cannot be reconstructed anywhere else.

**The multi-repo spec is a hard prerequisite**, not a neighbour:
`docs/superpowers/specs/2026-09-05-multi-repo-projects.md` (branch
`docs/multi-repo-plan`, unmerged) moves that answer onto the project and
introduces a resolved workspace. Once it lands, a cloud session's workspace is
*"clone these repos at this ref"* — something a pod can materialise. Land it
first.

---

## 6. Credentials

### 6.1 A token, minted locally, sealed per session

`claude setup-token` on the user's machine, stored in the provider's secret
manager, injected at container start. Subscription billing is preserved. Never
in the image, never in an agent bundle, never in SQLite.

### 6.2 `SecretBox` is the right seam with the wrong signature

`safeStorage` is referenced in exactly one place — `electronSecretBox`
(`ipc/index.ts:173-181`), injected into `NotionMcpAuth` at `ipc/index.ts:229`.
Nothing else touches it. A genuinely clean seam.

Two problems. It is **synchronous** (`notion/secretBox.ts:8-11`) and every
cloud KMS is async, with synchronous consumers all the way up to an IPC
handler. Use envelope encryption — KMS unwraps a data key once at boot and
`SecretBox` stays synchronous over AES-GCM — or make the chain async, which is
shallow but real. And its **threat model does not transfer**: its doc comment
scopes it to Notion, whereas the CLI token must be decryptable *inside the
container running the agent*. Scope that grant to one session's secret; do not
hand the engine a general unwrap.

### 6.3 Codex has no headless login

A Codex container would need the `codex` binary on PATH (resolved by `which`
at detection, `runners/codex.ts:81-86` — note this is **not** the
`@openai/codex-sdk` package), `~/.codex/auth.json` with `auth_mode: "chatgpt"`
(`auth/detect.ts:49-55`), `~/.codex/models_cache.json`, and `~/.codex/sessions`
for resume. The ChatGPT login is interactive and machine-bound, and there is no
`setup-token` equivalent.

State this as a limitation rather than discovering it in implementation:
**cloud mode is Claude-only until a headless Codex login exists.**

Incidentally, `@openai/codex-sdk` is in `dependencies` and imported nowhere in
`electron/`, `src/`, `shared/` or `tests/`. It is dead weight that the arch
guard still polices.

---

## 7. The container

- **Native modules.** `postinstall` runs `electron-builder install-app-deps`,
  which rebuilds `better-sqlite3` and `node-pty` against *Electron's* ABI. A
  container needs a plain `npm rebuild` against the *Node* ABI; the desktop's
  `node_modules` cannot be copied in. Install for the target platform
  explicitly (`--os=linux --cpu=<arch> --libc=<glibc|musl>`) so §2.7's silent
  failure cannot recur, and carry `build/afterPack.cjs`'s assertion into the
  image build.
- **A third build target.** `electron.vite.config.ts` needs an engine target
  emitting `engine/index.js` **and** `engine/mcpStdio.js`, preserving
  `externalizeDepsPlugin` and `entryFileNames: '[name].js'` — because
  `stdioEntryPath()` resolves `mcpStdio.js` relative to `import.meta.dirname`
  (`runners/mcpBridge.ts:315-317`).
- **The MCP bridge survives.** `process.execPath` becomes the container's
  `node`; `ELECTRON_RUN_AS_NODE=1` is ignored by plain Node (harmless, but now
  a lie — make it conditional). The unix socket needs a writable `/tmp`; the
  104-byte path limit (`mcpBridge.ts:301-307`) is satisfied by `tmpdir()`.
- **`node-pty` is imported eagerly** (`pty/manager.ts:1`). If the image offers
  no terminals, put it behind a dynamic import so the image needs no rebuild
  toolchain.
- **Isolation is an input, not a constant.** `codexPermissionOverrides`
  computes writable paths from `gitMetadata(cwd)` and `worktreesDir()`
  (`runners/codex.ts:183-200`) — a fine-grained sandbox *inside* what is
  already a container.

---

## 8. What does not go to the cloud

- **Terminals, by default.** `PtyManager.open` spawns a login shell with
  `{ ...process.env }` in the agent's cwd (`pty/manager.ts:73-79`). Exposed
  over the same socket that is an interactive shell in the container with the
  CLI token in its environment — not a gate an agent passes but a door a user
  opens. If offered at all it is a separately granted capability with its own
  audit trail. Note also that `pty.write` is fire-and-forget
  (`preload/index.ts:75`) and scrollback is per-process memory.
- The updater, window chrome, native dialogs, the directory picker, skill
  linking, and `safeStorage` as an implementation.

---

## 9. Phases

**0 — Prerequisite.** Land the multi-repo spec's workspace resolution (§5.6).

**1 — Durable parking, desktop only, no container.** Persist approvals into
the existing table; make `queued` durable; fix `recoverInterruptedRuns`; fix
the `PlanFlow.approve` ordering window; implement suspend-for-questions; write
§4.4's test. *Ships value on its own:* quitting Roster mid-approval stops
losing the turn, and a stranded `building` plan stops happening. It also
answers the hardest behavioural question before any infrastructure exists.

**2 — Extract the engine, still embedded.** Repository interfaces; an
`engine/` package; Electron main constructs it; no behaviour changes. Guarded
by the existing suite plus a test asserting no `electron` import under
`engine/`.

**3 — Split the contract.** `RosterShellApi` / `RosterEngineApi`;
confirmations move to the renderer; host-relative payloads fixed; `seq`,
`since`, protocol version, reconnect. Still entirely local, so the
load/subscribe race is fixed before latency can expose it.

**4 — The engine runs headless on the same machine.** A plain Node process
over the same `~/roster`, with the desktop connecting over a local socket
instead of IPC. **This is the real proof of "identical logic"** — same code,
same data, different transport, no cloud. Everything the network boundary
breaks surfaces here, where it can be debugged.

**5 — One container, one session, pinned.** Linux image; token in the secret
manager; a volume for `~/.claude` and the workspace; idle timeout and **no
scale-to-zero**. Claude only.

**6 — Multi-tenancy and authorisation.** Principals, ownership, per-session
secret scoping, `prepare → commit` deletes.

**7 — Scale to zero.** Snapshot/restore, or the SDK `SessionStore` adapter — a
cost optimisation on a system that already works.

**8 — Codex, if a headless login appears.**

---

## 10. Open questions

- **Two engines, one nudger.** `SessionNudges` is an unguarded singleton timer
  (`nudges.ts:30-40`). A desktop engine and a cloud engine over one backend
  both nudge. `markNudged` gives a durable cooldown, so it is mostly safe, but
  it is a read-then-write race with no leader election. Same for
  `TaskMentions.dispatch` and every `fs.watch` in the store layer.
- **What "identical" is allowed to mean.** Cloud mode already differs in one
  way by decision: no per-tool gate for Claude. Are there others we accept?
- **Where a cloud agent's skills and MCP servers come from.** This is the open
  TODO item *"share skills and mcps in the cloud"*, and the shareable-agent
  bundle in `docs/superpowers/plans/2026-09-06-workspace-and-agent-sharing.md`
  is the nearest existing design — but it deliberately carries key *names* and
  never values, which is precisely the rule a deployment must replace.
- **MCP auth for a cloud agent** — the open TODO item of the same name. Today
  Notion is proxied through a per-turn local socket so no token reaches a
  child (`manager.ts:431-437`). The same shape should hold remotely, but the
  OAuth loopback (`notion/loopbackCallback.ts`) assumes the browser and the
  process are on one machine.

---

## 11. Risks

- **The alpha `SessionStore` may change.** It is the only clean answer for
  Claude; phase 5 does not depend on it.
- **Snapshot fidelity.** Codex's rollout format is undocumented, so option C
  is riskier for Codex than for Claude.
- **A long-lived token is a long-lived liability.** Rotation and revocation
  need designing before phase 5, not after.
- **Scope creep into a workspace manager.** The multi-repo spec's own warning
  applies with more force here: *"Every question has a bigger answer that
  involves Roster running git. It should not."*

---

## 12. What this plan does not do

- It does not make local agents work differently in any respect.
- It does not move local state to a server.
- It does not implement an agent loop, or replay transcripts in place of CLI
  resume (§5.3, option D).
- It does not put a terminal in the cloud by default.
- It does not support Codex in the cloud.
- It does not ship a Kubernetes or Azure manifest. Phases 1–4 contain no
  infrastructure at all, and the first four are worth doing whether or not the
  rest ever happens.
