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
runner_session_id, status, project_id), `messages` (id, session_id, kind, role, content
JSON, created_at), `approvals` (id, session_id, tool_name, command, status, decided_at),
`usage` (session_id, input_tokens, output_tokens, cost_usd), plus the board:
`projects` (id, name, color, description), `tasks` (id, title, description, status,
priority, assignee_id, project_id, labels JSON), `task_comments` (id, task_id, author,
tone, text, is_system), and `counters`, which is what makes a task key durable.

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
  tasks.ts       SQLite    findAll, create, apply, comment, comments, subscribe
  projects.ts    SQLite    findAll, create, update, delete
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

`agents`, `skills`, and `mcp` are `WatchedStore`; the SQLite stores are plain `Store`,
with one exception — `tasks`, which agents write as well as Roster (see §13). This
is what makes the Edit modal's "changes are written back to agent.toml" true in both
directions — external edits reach the UI without a restart.

## 6. Screens and state

Six screens per the handoff: Agents Grid (default), Agent Detail, Skills, MCP Servers,
New Agent, and Tasks. Spend stays a disabled placeholder.

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
10. **Handoff and the task tools are Claude-only for now.** Both are implemented on one
    in-process MCP server — `list_agents` and `open_session`, plus `list_tasks`,
    `read_task`, `update_task`, `comment_on_task` and `create_task` — which only the
    Claude runner supports. Codex and custom runners can be handed *to* and assigned a
    task, but cannot hand off or work the board themselves.
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
13. **MCP enablement lives only in `agent.toml`.** `mcp.json` says which
    servers exist and how to launch them; each agent's `mcp_servers` says which
    it uses. Storing it in both — as `mcp.json`'s `enabledFor` originally did —
    meant the MCP screen wrote one and the session manager read the AND of
    both, so a chip could read as enabled while nothing launched. The field is
    dropped on load, so older files migrate silently.
14. **The window controls are colour coded.** The handoff draws three
    identical `#24262f` dots, which say nothing about which is which. They now
    follow the traffic-light convention — amber minimize, green maximize, red
    close — in the app's own status palette rather than macOS's saturated one,
    which would shout beside everything else in the chrome. Colour is never
    the only signal: each keeps its `aria-label` and gains a tooltip.
15. **Tasks ships; Spend does not.** §6 originally said both stayed placeholders. The
    board is now real, backed by SQLite, with the projects the handoff's data model
    already named.
16. **`TaskStore` carries a change subscription**, unlike the other SQLite stores. §5's
    "Roster is the only writer, so a row cannot change underneath it" stops being true
    the moment an agent holds the task tools, so this store publishes its changes and
    the IPC layer bridges them to the renderer — the same shape `SessionManager` uses.
17. **History attributes a move to whoever made it**, not to the task's assignee as the
    prototype does. Roster knows who acted — a drag is the user, a tool call is the
    agent — where the prototype had to guess from the assignee field.
18. **Two dependencies beyond the handoff's suggested stack**, both raised before use:
    `@dnd-kit/core` + `@dnd-kit/sortable` for the board, and `react-markdown` +
    `remark-gfm` for task descriptions. dnd-kit was chosen over native HTML5 drag for
    keyboard dragging; react-markdown over the prototype's line parser because agents
    write these descriptions and will emit fences, tables and links the parser would
    print as literal text. Raw HTML stays disabled for the same reason.
19. **`Modal` and `Select` primitives extracted.** Three modals became six, and the
    overlay chrome had already drifted — `EditAgentModal` closed on Escape and
    `McpServerModal` did not. Both now share one shell, which fixes that. `Select` is a
    real `<select>`, as the handoff specifies, so keyboard and screen-reader behaviour
    come for free.
20. **Task keys are `ROS-<n>` from a durable counter**, not per-project prefixes and not
    a row count. Deleting ROS-3 must not hand the next task the same key, or two History
    logs referring to it mean different things.
21. **Sessions carry a hand-assigned `projectId`**, set from a picker in the Agent Detail
    config rail. The handoff shows the Agents Grid project filter but never says where a
    session's project comes from, and nothing can infer it — the handoff's own roster has
    four agents sharing `~/work/api`, so a cwd says nothing about which piece of work a
    session is.
22. **A task card is a `div` with `role="button"`, not a `<button>`.** Enter opens the
    task and Space lifts it for a keyboard drag; a native button activates on Space too,
    which would fight the drag sensor for the same key.
23. **The board has no status bar.** The handoff specifies the decorative footer for the
    Agents Grid only.

24. **The grid's status bar totals the roster, not "the session".** The handoff puts a
    tokens/cost readout at the right of that bar and labels it `session`, but no session
    is current on the Agents Grid — the prototype's figure was static demo text. It now
    sums what every agent has spent, which is the honest figure at that altitude.
25. **The skills editor is a highlighted textarea, not a read-only code view.** The
    handoff specifies a line-numbered, markdown-coloured view; the real file is editable,
    and a `<textarea>` cannot colour its own contents. The colour is a `<pre>` and the
    textarea sits transparently over it, so the 46px gutter and the header/code/list
    colouring are as specified while the file stays editable. Nothing is hidden or
    reflowed — backticks stay visible, because this is an editor and what you see has to
    be what is on disk.

26. **The task detail's assignee opens on an empty query.** The prototype pre-fills the
    field with the current assignee's name, which then filters the suggestion list down
    to that one agent — putting "Unassigned" and every other agent out of reach of the
    control meant to offer them. The name still shows whenever the field is closed.

27. **Chat messages render Markdown.** §2 specifies a plain-text body that preserves
    newlines, which is what the prototype's hand-written demo prose needed. Real agents
    write Markdown on almost every turn — fenced code, headings, lists — and a live turn
    showed the backticks printing verbatim. Bodies now go through the same renderer the
    task board uses, so a fence looks the same wherever an agent wrote it. Raw HTML stays
    disabled, as it is there. Requested explicitly after the drift was reported.
28. **Tool rows report how long the call took.** The field was plumbed through the
    renderer but never written; the manager now stamps each call on start and fills the
    duration in when its result lands. A call still running stays undefined, so its row
    keeps showing `…` rather than claiming it had finished.

29. **E2E runs through a dev-only harness, not Playwright.** `ROSTER_SCRIPT=<file>`
    executes a script against the built app's real DOM and IPC. It exercises the actual
    Electron main process, which is what the risky code lives in, and needs no browser
    driver. Playwright remains an option if browser-level fidelity is ever needed.

30. **The task board is an MCP server, listed and enabled per agent.** Roster runs it
    in-process rather than launching it, but it appears in the Installed list beside the
    servers from `mcp.json` and is switched on per agent the same way — by name, in that
    agent's `mcp_servers`. Which agents may change the board is a real decision, and the
    MCP screen is already where per-agent tool access is granted; a second mechanism
    would be a second place it could be wrong. Handoff stays ungated: it opens sessions
    inside Roster and changes nothing a person owns. Built-ins are never written into
    `mcp.json`, have no launch command or environment, and cannot be shadowed by an
    entry of the same name.

31. **A tool row's expanded panel shows the call, not just the output.** The handoff
    says expanding shows the output; for `AskUserQuestion` that is one line — whether it
    was answered — while the question and its options exist nowhere else, since the
    collapsed row is a single truncated line. The panel now labels Arguments above
    Output, and the tool event carries the full input alongside the one-line summary.
    Only when the summary is not already the whole call: a one-field call like Read's
    path gets no Arguments block, because repeating the row above it is noise.

32. **Plan mode is a per-turn choice, made in the composer.** A "Plan" toggle beside
    Send puts the next turn in the SDK's plan mode: the agent researches and proposes
    but refuses every edit. Per session rather than per agent, and in the store rather
    than agent.toml, because planning one piece of work says nothing about the session
    in the tab beside it. The plan arrives as an ExitPlanMode approval, so the banner
    leads with the plan's heading and reads "Start work" / "Keep planning" rather than
    "Approve" / "Deny"; starting work clears plan mode, or the next turn would refuse
    to do the work just approved.

33. **One project filter for the whole app.** The board and the grid render the same
    `ProjectFilter` over the same `projectFilter` state, so choosing a project on one
    holds on the other. They started as two identical-looking controls over separate
    state, which read as a bug: picking a project on the board left the grid showing
    every agent. Picking a project is a statement about what you are looking at, not
    about which screen you are on.

34. **A skill you already have is linked, not copied.** "Add skill" takes a folder from
    the native picker and symlinks it into `~/roster/skills`, so Roster's editor edits
    the real file and the runner is handed the real path. A copy would go stale the
    moment either side changed, and skills people already have tend to live in a repo
    they keep working on. The folder must contain a SKILL.md, cannot be inside the
    library, and cannot be added twice. `load()` follows the link and skips a dangling
    one; removing a linked skill unlinks it rather than trashing it, and the confirm
    dialog says so — trashing a link would take the user's own folder with it.

35. **A question is answered in the transcript, not allowed in the banner.** A question
    tool reaches Roster as a permission request, and its input carries an `answers` field
    the permission step is expected to fill in — so answering the question and allowing
    the call are one act. `canUseTool` now resolves with
    `{behavior: 'allow', updatedInput: {...input, answers}}`, keyed by question text.
    The options are drawn where they were asked, because Approve/Deny is the wrong shape
    for a question: allowing one with nothing filled in only tells the agent that nobody
    replied. That is still reachable, as Skip. The banner is suppressed for an approval
    carrying questions, so there are never two controls over the same decision. A single
    single-select question answers on one click; anything more gathers first, or the
    first click would answer the rest with silence. "Other" is offered per question
    because the tool's own description promises the model it will be.

## 14. Build order

1. Scaffold: Electron + React + Tailwind tokens, sidebar, routing across five screens.
2. Data layer: `agent.toml` read/write/watch, SQLite schema, Zustand store, Agents Grid.
3. Runner abstraction with the `claude` adapter; Agent Detail chat pane live end to end.
4. Terminal pane; config rail; Edit modal with draft semantics.
5. Skills and MCP screens against real filesystem and config.
6. `codex` and `custom` adapters; approval gating; New Agent form.
