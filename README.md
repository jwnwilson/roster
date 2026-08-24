# Roster

A desktop app for managing a roster of AI coding agents — chat with them, watch
their terminals, approve risky actions, and let them hand work to one another.

**Roster does not implement an agent loop.** Each agent is backed by an agent CLI
running on your own account — Claude Code, Codex, or any command you point it at.
Roster is a harness and a UI over those processes, which means it needs no API
keys on the primary path, never executes tools itself, and never manages context.
The CLI owns all of that.

---

## Requirements

| | |
|---|---|
| Node.js | 22 or newer (developed on 25.2) |
| Platform | macOS (Windows and Linux are untested) |
| At least one agent CLI | [`claude`](https://code.claude.com) or [`codex`](https://developers.openai.com/codex/cli), already signed in |

Roster drives whichever CLI you already have installed and logged in. If none is
available, the app still runs — agents just show `error` with the reason, e.g.
*"not signed in — run `claude auth login`"*.

## Getting started

```bash
npm install     # also rebuilds better-sqlite3 and node-pty for Electron
npm run dev     # launches the app with hot reload
```

On first run Roster seeds `~/roster` with four example agents, five skills, and an
MCP config. Nothing is overwritten if that directory already has agents in it.

Point it somewhere else while developing:

```bash
ROSTER_HOME=/tmp/roster-scratch npm run dev
```

## Running the tests

```bash
npm test                  # everything — 395 tests, ~5s
npm run test:watch        # re-run on change
npm run test:coverage     # with thresholds enforced
npm run test:main         # main-process only (215 tests)
npm run test:renderer     # renderer only (180 tests)
npm run typecheck         # both tsconfigs
npm run check             # typecheck + coverage + build, i.e. what CI would run
```

Filter by test name — the string matches against `describe` and `test` titles:

```bash
npx vitest run -t "approval"     # the 10 tests covering the approval gate
```

### How the suite is organised

Two Vitest projects, because the two halves need different environments:

| Project | Environment | Location | Covers |
|---|---|---|---|
| `main` | node | `tests/main/` | Stores, runners, session manager, pty, SQLite |
| `renderer` | jsdom | `tests/renderer/` | Screens, chat, state, the preload bridge (stubbed) |

**Everything runs offline.** Runner adapters are tested against JSON recorded from
real `claude -p --output-format stream-json` and `codex exec --json` runs
(`tests/main/fixtures/`), so no test spends money or needs a network. The pty tests
do drive a real shell, and the subprocess tests spawn throwaway scripts — both are
local and fast.

### Coverage

Thresholds are enforced in `vitest.config.ts`: 80% statements, lines, and
functions; 70% branches. Four files are excluded, each because a unit test would
exercise a mock rather than the code:

| File | Why | Covered instead by |
|---|---|---|
| `electron/main/index.ts` | Window creation; needs a real Electron `app` | The E2E harness below |
| `electron/main/ipc/index.ts` | Thin delegation to stores that are covered | The E2E harness below |
| `src/terminal/TerminalPane.tsx` | xterm needs a real canvas; jsdom has none | A live shell in the built app |
| `src/main.tsx` | Four-line React bootstrap, no branching | — |

Nothing with real branching logic is excluded.

### End-to-end checks

There is no Playwright setup. Instead the built app takes two dev-only env vars,
which run a script against its **real** DOM and IPC — the actual Electron main
process, which is where the risky code lives:

```bash
npm run build

# Run a script inside the running app and print its return value
ROSTER_SCRIPT=./scratch/e2e.js npx electron .

# Capture the window to a PNG
ROSTER_SCREENSHOT=./shot.png npx electron .
```

A script is plain JS evaluated in the renderer; whatever it resolves to is printed
as `[script] {...}`. This is how live agent turns, the approval gate, the pty, and
agent-to-agent handoff were verified.

## How it fits together

```
electron/main/          the privileged half — no credential ever reaches the renderer
  runners/              Runner interface + claude | codex | custom adapters
  store/                one module per data kind, across both storage substrates
  sessions/             drives a turn: stream events, persist, republish
  pty/                  one pty per session
  auth/                 CLI detection and auth probing
  ipc/                  typed channels
electron/preload/       contextBridge → window.roster
src/                    React renderer — screens/, chat/, terminal/, state/
```

**Two sources of truth, deliberately.** Agent configuration lives in `agent.toml`
files on disk, so it is readable, diffable, and editable outside the app — a file
watcher reflects external edits back into the UI without a restart. Everything
runtime (sessions, messages, approvals, usage) lives in SQLite. Neither duplicates
the other.

**Runners normalise every CLI to one event stream.** Nothing above
`electron/main/runners/` knows which CLI produced an event. Adding a new one means
writing a normalizer and, ideally, recording a fixture from a real run.

## Where your data lives

```
~/roster/
  agents/<id>/agent.toml   one file per agent — hand-editable
  skills/<name>/SKILL.md   the shared skill library, nested files and all
  workspace/               default working directory for seeded agents
  mcp.json                 MCP servers: launch command and environment
  roster.db                sessions, messages, approvals, usage
```

## Running against a local model

Roster drives agent CLIs, so a local model is a matter of pointing one at a
local server rather than adding a provider. Codex ships this: install
[Ollama](https://ollama.com), `ollama serve`, pull a model, then give an agent
its own runner in `~/roster/agents/<id>/agent.toml`:

```toml
runner = "ollama-codex"
model  = "gpt-oss:20b"

[custom]
command = "codex"
args = [
  "exec", "--json", "--skip-git-repo-check",
  "--sandbox", "workspace-write",
  "--oss", "--local-provider", "ollama",
  "-C", "{cwd}", "--model", "{model}", "{prompt}",
]
```

Roster reads the dialect from the command name, so `codex` here means its JSON
event stream is understood — tools, approvals and streaming all work as they do
for the built-in runner.

`--local-provider` must be given explicitly: without it Codex prompts
interactively for a provider, and Roster runs it non-interactively. `lmstudio`
works in place of `ollama`. Codex talks to these over the OpenAI *Responses*
API, so a server that only speaks chat-completions will not work.

## The app icon

The icon is generated, but committed, so a build machine without Python still
gets one:

```bash
python3 scripts/make-icon.py   # writes build/icon.png and build/icon.icns
```

Rerun it after changing the mark. `src/components/Logo.tsx` draws the same mark
in the sidebar and has to be kept in step by hand — the script's docstring says
which cut it mirrors.

To see it on a real bundle:

```bash
npx electron-builder --dir --mac   # release/mac-arm64/Roster.app
```

## Design and decisions

- `docs/design_handoff/` — the original design: screens, tokens, and the HTML prototype
- `docs/superpowers/specs/2026-08-23-roster-design.md` — the design spec, including
  every deviation from the handoff and why it was made

## Known gaps

- **Codex and custom runners do not stream.** Their replies arrive whole rather than
  token by token. The activity indicator ("Thinking …", "Running `pytest` …") covers
  the wait, but the prose itself still appears all at once.
- The composer's attachment chip is decorative — attachments are not wired to real files.
- **Handoff is Claude-only.** It works through an in-process MCP server, which only the
  Claude runner supports. Other runners can be handed *to*, but cannot hand off.
- Tasks and Spend are disabled placeholders, as in the original design.
- **Only the Claude runner uses MCP servers.** Codex and custom runners drop the
  config silently — an agent on those runners can name servers in its
  `mcp_servers` and nothing will start them.
- **The MCP registry is a static catalogue.** Nine hardcoded entries, nothing
  fetched, and the suggested launch command is derived as
  `npx @modelcontextprotocol/server-<name>` rather than stored per entry — so it
  is only a starting point, editable before install.
- **MCP server environments are stored in the clear**, in `~/roster/mcp.json`.
  Tokens there are as exposed as any dotfile's; there is no keychain integration.
- **There is no way to remove an MCP server from the UI.** Delete it from
  `mcp.json` by hand.
- Model prices are a table Roster maintains for Claude; Codex publishes none, so that
  column is left empty rather than invented.
