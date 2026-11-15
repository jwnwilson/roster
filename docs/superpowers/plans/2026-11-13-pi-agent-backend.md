# Pi Agent Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi (`@earendil-works/pi-coding-agent`) the single agent backend. Roster becomes a UI and orchestration layer over Pi sessions: roster, board, plans, handoffs, approvals and spend stay; the per-CLI adapters (Claude Agent SDK, Codex SDK, custom argv runners) go.

**Why:** Today every Roster feature is built twice and degrades differently per CLI — approvals (`canUseTool` vs Codex's MCP workaround, ADR 0005), Roster tools (in-process MCP vs the stdio bridge in `mcpBridge.ts`/`mcpStdio.ts`), plan mode (`ExitPlanMode` vs `propose_plan`), usage (`normalizeClaude` vs `normalizeCodex` + `costs/codex.ts` estimates, ADR 0002/0004). Pi gives one in-process TypeScript API with:

| Roster need | Pi mechanism |
|---|---|
| Run a turn, stream text/tools | `createAgentSession()` + `session.subscribe()` (`message_update`, `tool_execution_*`, `agent_settled`) |
| Many providers, subscription logins | Pi `ModelRuntime` + `auth.json` (`/login` OAuth: Anthropic, OpenAI/Codex, …) |
| Approvals | Inline extension `tool_call` handler returning `{ block, reason }` after awaiting the UI |
| Roster tools (handoff, tasks, plans, memory) | `customTools` — plain in-process functions, **no MCP bridge** |
| User MCP servers | `createMcpExtension()` in `extensionFactories` |
| Skills | `DefaultResourceLoader` skill overrides (explicit paths, discovery off) |
| Resume / fork (handoff) | `SessionManager` session files + `AgentSessionRuntime.fork()` |
| Plan mode | `tools` restricted to read-only set + a `propose_plan` custom tool |
| Spend | Exact per-message `usage` / cost from Pi — no estimate tables |
| Steering mid-turn | `session.steer()` / `followUp()` (new capability) |

**Non-goals:** Changing the renderer's look, the board, Notion, the store schema beyond what is listed, or the updater/release pipeline.

**Tech Stack:** Electron main process, TypeScript, Vitest, `@earendil-works/pi-coding-agent` SDK (in-process, main process only).

## Global Constraints

- One worktree, branch `feat/pi-backend`, one PR per phase (phases below are independently shippable). Never commit to `main` — a push there is a release.
- `npm install` in the fresh worktree (native rebuilds). `npm run check` green before every PR: 80/80/80/70 coverage.
- Tests first. `npm run typecheck` before every commit (Vitest does not typecheck).
- Pi runs **in the Electron main process via the SDK**, not RPC: Roster is already Node, wants in-process custom tools, and avoids a JSONL protocol layer. Revisit RPC only for the k8s/remote runner (see *Later*).
- Keep the `Runner` / `RunnerEvent` contract in `electron/main/runners/types.ts` as the seam during migration, so `sessions/manager.ts` and the renderer change last and least.

---

## Phase 0 — Spike (1 day, throwaway branch)

- [ ] Add `@earendil-works/pi-coding-agent`; confirm it bundles in `electron.vite.config.ts` main build (ESM/CJS, no native deps) and runs under Electron's Node.
- [ ] Script: create a session in a temp repo with an inline extension that blocks `bash` until a promise resolves, one `customTools` entry, `SessionManager` under a temp dir. Prompt, observe events, abort, resume from file, fork.
- [ ] Confirm the credential story: Pi's `auth.json` location is configurable (agent dir) so Roster can use `~/roster/pi/` or the user's `~/.pi/agent`. Decide which (recommend: user's `~/.pi/agent` by default, so `/login` in a terminal "just works"; overridable by `ROSTER_HOME` for dev).
- [ ] Write ADR `docs/adr/0008-pi-is-the-agent-backend.md` capturing the decision and that it supersedes README's "Claude Code or Codex" positioning.

**Exit:** a written yes/no on every row of the table above. Any "no" becomes a task or a blocker before Phase 1.

## Phase 1 — `PiRunner` behind the existing contract

Files: create `electron/main/runners/pi/{runner.ts,normalize.ts,approvals.ts,tools.ts,models.ts}`; modify `registry.ts`, `shared/types.ts` (`BUILTIN_RUNNERS` += `'pi'`), `store/agentToml.ts`, `auth/detect.ts`.

- [ ] **normalize.ts** — pure function Pi `AgentSessionEvent` → `RunnerEvent[]`. Tests from recorded event fixtures (`tests/fixtures/pi/*.jsonl`): text deltas, tool start/end → `tool`/`result`, usage → running totals (`totalTokens` incl. cache, `costUsd` from Pi), `agent_settled` → `done` with the session file id, errors.
- [ ] **runner.ts** — `PiRunner implements Runner`:
  - `run(prompt, opts)`: builds `createAgentSession({ cwd, model, sessionManager, resourceLoader, tools, customTools })`, maps `systemPrompt` → append-system-prompt, `skills` → explicit skill paths with discovery off, `mcpServers` → MCP extension config, `additionalRoots` → documented as read+write (same caveat as Claude), `resumeFrom`/`fork` → open/fork session file. Bridges `opts.signal` → `session.abort()`. Yields via an async queue fed by `subscribe`. Always `dispose()`.
  - `detect()`: Pi importable + at least one authenticated provider in `ModelRuntime`; error text points at `pi /login`.
  - `models()`: `ModelRuntime` available models → `ModelInfo[]` (`provider/model` ids).
- [ ] **approvals.ts** — inline extension: on `tool_call` for write/exec tools, emit `{kind:'approval'}` and await a deferred keyed by tool-call id; `respondToApproval` resolves it → `{block:false}` or `{block:true, reason}`. Question tool: a custom `ask_user` tool whose execute awaits the same approval path with `questions` and returns `answers`.
- [ ] **tools.ts** — adapt `handoffTool.ts`, `taskTools.ts`, `planTools.ts`, `memoryTools.ts` handlers to Pi `customTools`. Refactor each module so its *handlers* are transport-free and the MCP wrapper is a thin adapter (shared by Claude/Codex until Phase 3).
- [ ] **Plan mode** — `planMode` ⇒ tool set limited to read/grep/find/ls + `propose_plan`; `propose_plan` raises an approval with `plan`. Reuse `planFlow.ts`; make `planPrompt.ts` wording tool-neutral (it already must be per the Codex plan).
- [ ] `agent.toml`: `runner = "pi"`, `model = "anthropic/claude-sonnet-…"` style ids. Validation tests.
- [ ] `sessions/manager.ts`: replace `instanceof ClaudeRunner/CodexRunner` branching (around L438) with a capability on `Runner` (`wantsInProcessTools`, `onApprovalNeeded`), so Pi needs no special case.

**Exit:** a Pi agent can chat, edit, be approved/denied, hand off (fork), use the board/plan/memory tools and MCP servers, with exact spend. Claude/Codex still work. `npm run check` green.

## Phase 2 — Make Pi the default

- [ ] `store/defaultAgents.ts` / `seed.ts`: seed Tech Lead / Implementer / Reviewer as `runner = "pi"`, models chosen from what `ModelRuntime` reports as authenticated (Anthropic → Sonnet/Opus, else OpenAI, else first available).
- [ ] First-run card + agent error states: "sign in to a provider — run `pi` then `/login`" (or embed a login flow later).
- [ ] `NewAgent.tsx` / `EditAgentModal.tsx`: runner picker collapses to a **provider/model picker** fed by `models()`; thinking level picker (`set_thinking_level` equivalent).
- [ ] Spend screen: Pi's actual cost; mark legacy Codex rows as estimates (unchanged data).
- [ ] Migration: on load, offer (not force) converting `runner = "claude"` → `pi` + `anthropic/<model>`, `runner = "codex"` → `pi` + `openai-codex/<model>`. Existing `runnerSessionId`s cannot carry over — converted agents start a fresh Pi session; old transcripts remain readable in Roster's DB.
- [ ] README + landing page: "Roster is a UI over Pi"; requirements become "Pi signed in to at least one provider".

## Phase 3 — Remove the old backends

Only after Phase 2 has shipped in a release and been used.

- [ ] Delete `runners/{claude,codex,custom,normalizeClaude,normalizeCodex,claudeCatalog,subprocess,mcpBridge,mcpStdio,questions}.ts`, `costs/codex.ts`, `auth/probes.ts` CLI probes, and their tests.
- [ ] Remove `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk` from `package.json`.
- [ ] Collapse `Runner` registry to Pi; keep the `Runner` interface (it is the test seam). `BUILTIN_RUNNERS = ['pi']`; `agentToml` maps legacy values with a clear error/migration message.
- [ ] Custom runners: replaced by Pi extensions/custom providers (document in README). Supersede ADRs 0002, 0004, 0005-codex.
- [ ] Re-check coverage thresholds after deletion; delete dead renderer branches keyed on runner id.

## Phase 4 — Pi-native improvements (optional, each its own PR)

- [ ] Steering: composer sends `steer`/`followUp` while a turn runs instead of queueing in Roster.
- [ ] Session tree: show Pi branches/forks in `AgentDetail` (`get_tree` equivalent).
- [ ] Compaction controls and context meter from `get_session_stats`.
- [ ] Pi skills/prompt templates/packages surfaced in `Skills.tsx`.

## Later — remote / k8s execution

Same `Runner` contract, second implementation `PiRemoteRunner` that drives `pi --mode rpc` in a pod (per the k8s design: one Job per task, gVisor, egress-locked, GitHub App token). Roster tools then run via a Pi extension calling back to Roster over an authenticated channel. Out of scope here; the Phase 1 refactor (transport-free tool handlers, capability-based manager) is what makes it cheap.

---

## Risks

| Risk | Mitigation |
|---|---|
| Pi SDK bundling in Electron main (ESM, dynamic imports of extensions) | Phase 0 spike; externalise in `electron.vite.config.ts` if needed |
| Subscription auth ToS / availability differs from official CLIs | Detect per provider; keep API-key path; document. Do not delete Claude/Codex runners until Phase 2 proves out |
| Pi runs in-process: a crashed tool or extension can take down main | Extensions limited to Roster's own; consider a utility process (`utilityProcess.fork`) hosting Pi if stability issues appear |
| Pi tools have no OS sandbox (Codex had `:workspace` profile) | Approvals gate writes/exec; document; Gondolin/containers as follow-up. This is a real downgrade for Codex users — call it out in the PR |
| Loss of existing CLI session continuity | Explicit, opt-in migration; transcripts preserved |
| Pi API churn (pre-1.x semantics in places) | Pin exact version; all Pi types confined to `runners/pi/` |

## Verification per phase

`npm test`, `npm run typecheck`, `npm run check`; plus a manual run with `ROSTER_HOME=/tmp/roster-pi npm run dev`: create a Pi agent, edit a file with approval, deny a command, hand off to a second agent, run plan mode, check Spend.
