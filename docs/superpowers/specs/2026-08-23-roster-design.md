# Roster — Design

**Status:** approved for planning
**Date:** 2026-08-23
**Design source:** `docs/design_handoff/README.md` + `docs/design_handoff/Roster.dc.html`

## 1. What Roster is

A desktop app for managing a roster of AI coding agents. Each agent has a runner,
model, working directory, system prompt, skills, and MCP servers. Users open agents
into chat or terminal sessions, approve risky actions, and agents hand off work to
one another by opening sessions on each other.

**The central architectural decision:** Roster does not implement an agent loop. Each
agent is backed by an agent CLI running on the user's own account — Claude Code, Codex,
or a user-supplied command. Roster is a harness and a UI over those processes.

This follows from a product requirement: users bring their own CLI tools and their own
LLM accounts. It also means Roster never handles API keys on the primary path, never
executes tools, and never manages context — the CLI owns all of it.

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Shell | Electron 43 | Node ecosystem for ptys, SQLite, MCP, agent SDKs |
| UI | React 19 + TypeScript + Vite 8 | via `electron-vite` |
| Styling | Tailwind 4 | Tokens in a CSS `@theme` block |
| State | Zustand 5 | Shape follows the handoff's State Management section |
| Chat | `@assistant-ui/react` 0.15 | External store runtime, unstyled primitives |
| Terminal | `@xterm/xterm` 6 + `node-pty` 1.1 | One pty per session |
| Persistence | `better-sqlite3` 13 | Sessions, messages, approvals, usage |
| Config | `smol-toml` | `agent.toml` per agent |
| Runners | `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk` | Plus a generic subprocess runner |

**Rejected:** Tauri (no first-party Rust SDKs for the agent CLIs; MCP and provider
tooling both live in the Node ecosystem). Direct Messages API calls with user-supplied
keys (would require reimplementing the agent loop and would not use the user's existing
subscription). Vercel AI SDK (dissolved once runners replaced direct API calls).

## 3. Process architecture

The renderer never sees a credential, a file handle, or a child process.

```
electron/main/
  runners/     Runner interface + claude | codex | custom adapters
  store/       one module per data kind, across both substrates (see §5)
  db/          better-sqlite3 connection + migrations only
  pty/         node-pty session manager
  mcp/         MCP server config written into runner options
  auth/        CLI detection + auth probing; env/keychain fallback
  ipc/         typed channels, one module per domain
electron/preload/   contextBridge -> window.roster
src/                React renderer: screens/, components/, chat/, terminal/, state/
```

IPC handlers never touch SQL or the filesystem directly — they call the store layer,
which is also the only place row shapes and file formats become domain types.

## 4. The Runner abstraction

The core new interface. Every agent resolves to exactly one runner.

```ts
interface Runner {
  readonly id: 'claude' | 'codex' | string
  detect(): Promise<RunnerStatus>          // installed? authed? which account?
  models(): Promise<ModelInfo[]>
  start(session: SessionSpec, prompt: string): AsyncIterable<RunnerEvent>
  resume(sessionId: string, prompt: string): AsyncIterable<RunnerEvent>
  fork(sessionId: string): Promise<string> // the handoff primitive
  respondToApproval(id: string, approved: boolean, reason?: string): void
  cancel(sessionId: string): void
}

type RunnerEvent =
  | { kind: 'text';     role: 'assistant'; delta: string }
  | { kind: 'tool';     id: string; name: string; args: unknown }
  | { kind: 'result';   id: string; output: string; isError: boolean }
  | { kind: 'approval'; id: string; toolName: string; command: string }
  | { kind: 'usage';    inputTokens: number; outputTokens: number; costUsd: number }
  | { kind: 'done';     sessionId: string }
  | { kind: 'error';    message: string }
```

**Adapters:**

- **`claude`** — `@anthropic-ai/claude-agent-sdk`. `query({ prompt, options })` with
  `cwd`, `systemPrompt`, `model`, `mcpServers`, `resume`, `forkSession`, and the
  `canUseTool` callback wired to `approval` events. Auth: `claude auth login`
  (subscription) or `ANTHROPIC_API_KEY`.
- **`codex`** — `@openai/codex-sdk`, backed by `codex exec --json`. Auth: `codex login`
  (ChatGPT account).
- **`custom`** — spawns any binary with a configured argv template and parses JSONL
  from stdout via field mappings declared in `agent.toml`. Covers Gemini CLI, aider,
  opencode, or a user's own script.

Runner availability is probed at startup and cached. An agent whose runner is missing
or logged out enters `error` status (see §9).

## 5. Data model

**Split of truth.** Agent configuration is `agent.toml` on disk — matching the Edit
modal's footer note. Everything runtime lives in SQLite. Neither duplicates the other.

`<cwd>/agent.toml`:

```toml
name = "Debugging Agent"
runner = "claude"
model  = "claude-opus-5"
system_prompt = """..."""
skills = ["repro-harness", "stack-triage"]
mcp_servers = ["filesystem", "postgres"]

# only for runner = "custom"
[custom]
command = "gemini"
args = ["--output-format", "json", "-p", "{prompt}"]
```

A file watcher reflects external edits back into the UI; Save writes the file.

SQLite tables: `sessions` (id, agent_id, title, origin, from_agent_id,
runner_session_id, status), `messages` (id, session_id, kind, role, content JSON,
created_at), `approvals` (id, session_id, tool_name, command, status, decided_at),
`usage` (session_id, input_tokens, output_tokens, cost_usd).

`origin` and `from_agent_id` are what render the `↳` glyph and the spawn/handoff
messages. `runner_session_id` is what `resume` and `fork` are keyed on.

### The store layer

Roster has two storage substrates — SQLite for runtime state, the filesystem for
configuration — and `agent.toml` is as much data access as the sessions table is. So the
store layer is organised by *what the data is*, not by where it happens to live:

```
store/
  sessions.ts    SQLite    findByAgent, create, updateStatus
  messages.ts    SQLite    findBySession, append
  approvals.ts   SQLite    pending, resolve
  usage.ts       SQLite    forSession, accumulate
  agents.ts      TOML      findAll, findById, update, watch
  skills.ts      FS dir    findAll, readFile, writeFile, watch
  mcp.ts         JSON      findAll, setEnabled, watch
```

Callers write `agents.update(id, patch)` without knowing the backing format. Three
things justify the layer, none of them being storage swappability:

- **SQL and `fs` calls stay out of IPC handlers**, which otherwise become the files that
  grow past 800 lines.
- **One place where raw shapes become domain types** — snake_case columns, the JSON
  `content` column, integer timestamps, TOML tables. Mapped per call site, these drift.
- **Validation at the boundary.** A hand-edited `agent.toml` is untrusted external input;
  it can name a runner that doesn't exist or omit `model` entirely. The store is where
  the schema check lives, which scattered `readFile` calls have no natural place for.

Stores are testable against an in-memory database and a temp directory, with no Electron.

**One asymmetry is real and stays visible in the types.** Roster is the only writer to
SQLite, so a row cannot change underneath it. Files can — someone edits `agent.toml` in
an editor, or checks out a branch. File-backed stores therefore carry a change
subscription that database stores do not:

```ts
interface Store<T> {
  findAll(): Promise<T[]>
  findById(id: string): Promise<T | null>
  update(id: string, patch: Partial<T>): Promise<T>
}

interface WatchedStore<T> extends Store<T> {
  watch(onChange: (ids: string[]) => void): Disposable
}
```

`agents`, `skills`, and `mcp` are `WatchedStore`; the SQLite four are plain `Store`. This
is what makes the Edit modal's "changes are written back to agent.toml" true in both
directions — external edits reach the UI without a restart.

## 6. Screens and state

Five screens per the handoff: Agents Grid (default), Agent Detail, Skills, MCP Servers,
New Agent. Tasks and Spend stay disabled placeholders.

Zustand store mirrors the handoff's State Management section exactly: `screen`,
`agentId`, `mode`, `sess` (agentId -> sessionId), `mcpTab`, `openTools`, `query`,
`gridQuery`, `editOpen`, `draft`, `overrides`, `agentSkills`, `prompts`, `picked`,
`mcpOn`. Draft semantics are preserved — opening Edit snapshots current config, all
edits mutate the draft, Save commits and writes `agent.toml`, Cancel discards.

## 7. Chat integration

SQLite is the source of truth; assistant-ui renders it via `useExternalStoreRuntime`
with a `convertMessage` mapping to `ThreadMessageLike`.

| Roster kind | assistant-ui part | Renderer |
|---|---|---|
| text | `text` | role label + mono timestamp + 13.5px/1.62 body |
| tool | `tool-call` | collapsed row, expands to `#101116` output |
| spawn | `data-spawn` | 2px `#3a3050` left accent + `↖ back to X` pill |
| handoff | `data-handoff` | link pills navigating to target agent + session |

`data-*` parts are assistant-ui's documented extension point for custom content, so
spawn and handoff are first-class rather than shoehorned into tool calls.

Rendering goes through `<MessagePrimitive.Parts>` with a render prop switching on
`part.type`. No assistant-ui default styling is loaded — unstyled primitives only,
with the project's tokens.

Two details the part model forces:

- A `data-<name>` part is authored as `data-spawn` but **arrives at render time as
  `{ type: 'data', name: 'spawn' }`**, so the renderer switches on `name`, not the
  authored type.
- The message header (role label + timestamp) is per-message chrome rather than a
  part, so it travels in `metadata.custom` and is rendered by the message component.

## 8. Terminal

One pty per session via `node-pty`, spawned in the agent's cwd, streamed over IPC to
xterm.js with the fit addon. The header shows real `cols×rows` rather than the
prototype's static `80×24`. Session-scoped: switching sessions switches ptys; closing a
session disposes its pty.

## 9. Approvals

Approval is driven by the runner, not by a heuristic in Roster.

1. The CLI requests permission (`canUseTool` for Claude Code; approval events for Codex).
2. The adapter emits an `approval` event and blocks that runner turn.
3. The session's status becomes `approval`; the grid card pulses (`rosterPulse`) and the
   amber banner appears naming the exact command in monospace.
4. Approve or Deny resolves the callback; the agent resumes or the tool is refused.

This is a genuine permission gate, not a visual one — the agent is actually blocked.

**Runner availability** reuses the same status vocabulary. An agent whose runner is not
installed or not authenticated shows `error` (`#c2553f`) — a status the handoff defines
but never uses — with the reason in the config rail. This keeps auth failures visible
without adding UI outside the visual spec.

## 10. Authentication

Resolution order per runner: existing CLI login (subscription) -> environment variable
-> `safeStorage`-encrypted value entered in-app. The primary path requires no key at
all. Keys, when present, are read only in the main process; the renderer receives only
a masked tail.

## 11. Design tokens

Every colour, size, and radius comes from the handoff's Design Tokens section, declared
once in a Tailwind 4 `@theme` block and consumed as utilities. No literal hex values in
components. Fonts are Instrument Sans and JetBrains Mono. Motion is limited to the two
named keyframes: `rosterPulse` (2s, approval cards) and `rosterBlink` (streaming dot and
terminal cursor). Hover transitions are ~120ms ease, per the handoff's recommendation.

## 12. Testing

Vitest for main-process logic: `agent.toml` round-trip, runner event normalisation per
adapter (against recorded CLI output fixtures), message conversion, cost math, auth
resolution order. React Testing Library for message renderers, screen state, and draft
semantics. Playwright for E2E against the built app: create agent, send a message,
approve a gated command, hand off between agents. Target 80% per `CLAUDE.md`.

Runner adapters are tested against recorded fixtures rather than live CLI calls, so the
suite runs offline and deterministically.

**Four files are excluded from coverage**, each because testing it would mean testing a
mock rather than the code:

| File | Why | Covered instead by |
|---|---|---|
| `electron/main/index.ts` | Window creation; needs a real Electron `app` | The live harness |
| `electron/main/ipc/index.ts` | Thin delegation to stores that are themselves covered | The live harness |
| `src/terminal/TerminalPane.tsx` | xterm needs a real canvas and `devicePixelRatio` | A live shell in the built app |
| `src/main.tsx` | Four-line React bootstrap, no branching | — |

Nothing with real branching logic is excluded.

## 13. Deviations from the visual spec

Each was raised and decided explicitly:

1. **Tailwind 4 `@theme` instead of `tailwind.config.js`.** Same tokens, same single
   source of truth; v4 removed the JS config. *Approved.*
2. **Provider cards keep their designed names** (Anthropic / OpenAI / Google) with the
   runner inferred behind each. *Approved — variant B.*
3. **Approval banner reads runner permission state.** Renders exactly where the spec puts
   it, in the session chrome rather than inline in the message list.
4. **Terminal header shows real terminal size** instead of a static `80×24`.
5. **`error` status becomes reachable** for missing or logged-out runners. Uses the
   colour and vocabulary the handoff already defines.
6. **Composer is a real input.** The prototype's static "Message X…" line becomes a
   working placeholder now that chat is live. The drop zone and skills line are
   preserved as designed; the attachment chip is **not** wired to real files and is
   the one affordance in the handoff that remains decorative.
7. **`agent.toml` lives at `~/roster/agents/<id>/`, not `<cwd>/`.** Forced by the data
   model: the handoff's own roster has four agents sharing `~/work/api`, which one
   file per directory cannot represent. Each config names its own `cwd`, and the
   location sits alongside the `~/roster/skills` the handoff already establishes.
8. **Seeded agents work in `~/roster/workspace`, not the user's home.** An approved
   write would otherwise land directly in `~`.
9. **Prices are shown only where Roster knows them.** The Claude table is data Roster
   owns; Codex publishes no prices, so that column is left empty rather than invented.
   Codex's model list is read from the CLI's own cache.
10. **Handoff is Claude-only for now.** It is implemented as an in-process MCP server
    exposing `list_agents` and `open_session`, which only the Claude runner supports.
    Codex and custom runners can be handed *to*, but cannot yet hand off.
11. **The skills tree uses folder and file icons, not the handoff's dots.** The
    handoff separates them by the radius of a 5px dot — `1.5px` against `50%` —
    which reads as noise at that size. Shape now carries the distinction and colour
    still carries state, an open file taking the accent. Creation and deletion also
    live on the rows as icons rather than in the header, since a header button
    cannot express *which* skill to act on.
12. **The sidebar logo carries a mark.** The handoff specifies a plain 16×16
    rounded-5px accent square. It is still that square, but it now holds the
    Roster mark — ragged-right rows, the top one amber — so the app icon and
    the in-app wordmark are the same thing. The mark's amber is the icon's
    `#ffca70` rather than the `#d9a04a` status token, which loses too much
    contrast against the accent at 16px to read as a separate row.
13. **E2E runs through a dev-only harness, not Playwright.** `ROSTER_SCRIPT=<file>`
    executes a script against the built app's real DOM and IPC. It exercises the actual
    Electron main process, which is what the risky code lives in, and needs no browser
    driver. Playwright remains an option if browser-level fidelity is ever needed.

## 14. Build order

1. Scaffold: Electron + React + Tailwind tokens, sidebar, routing across five screens.
2. Data layer: `agent.toml` read/write/watch, SQLite schema, Zustand store, Agents Grid.
3. Runner abstraction with the `claude` adapter; Agent Detail chat pane live end to end.
4. Terminal pane; config rail; Edit modal with draft semantics.
5. Skills and MCP screens against real filesystem and config.
6. `codex` and `custom` adapters; approval gating; New Agent form.
