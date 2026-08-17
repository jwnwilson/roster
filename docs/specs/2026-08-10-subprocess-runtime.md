# Roster — SubprocessRuntime design spec

**Date:** 2026-08-10
**Status:** Draft — extends `2026-08-01-roster-design.md` §3. Where the two disagree, the
original spec wins.

---

## 1. Why this exists

`FakeRuntime` is the only implementation of `AgentRuntime`. Every part of roster above it —
threads, turns, project memory, the whole UI — is proven against a scripted fake, so **no agent
has ever actually run**. This spec covers the runtime that makes roster do its job.

It deliberately does **not** cover the lead-agent coordination protocol. That is a second design
problem (§7) and bundling it here would delay the thing that makes a single agent work.

## 2. The contract it must satisfy

`adapters/agents/runtime.py` already fixes the shape, and nothing here changes it:

```python
def execute(agent, project_folder: str, task: str) -> AsyncIterator[tuple[str, str]]
async def summarise(agent, digest: str, entries: list[str], budget_bytes: int) -> str
```

`execute` yields `(message_kind, content)`. The kind is a plain `str` on purpose: a runtime is
project-agnostic and must not import roster's `MessageKind`. The turn manager maps anything it
does not recognise to `event`, so a runtime cannot crash a turn by naming a kind roster has not met.

## 3. What an agent is, as a process

An agent is a folder (`AGENT.md`, `skills/`, `config.yaml`). `config.yaml` currently carries
`model`, `token_limit` and `temperature` — **no command**, so there is nothing to execute.

**Decision: `config.yaml` names a *tool*, and roster owns the *command*.**

Agents run different models, and the model is already per-agent, so the CLI has to be too — an
agent on `gpt-5-codex` cannot be launched by `claude`. `config.yaml` gains one key:

```yaml
model: claude-opus-5
tool: claude        # claude | codex | antigravity
token_limit: 200000
```

`tool` is a **closed enum, not a command string.** Roster maps the name to an argv it builds
itself. This is the whole security property: an agent folder is operator content, and a folder
that could name an arbitrary command would let a malformed `config.yaml` execute anything —
turning "a broken folder degrades to Disabled" (spec §7) from a robustness feature into a security
boundary it was never designed to be. A name roster does not recognise is a **Disabled agent with
a readable reason**, exactly like a malformed `token_limit` today.

Defaulting: `tool` is optional and inferred from the model prefix (`claude-*` → `claude`,
`gpt-*`/`o[0-9]*` → `codex`, `gemini-*` → `antigravity`), so existing agent folders keep working
untouched. An explicit `tool` always wins over the inference.

Each tool's argv lives in one table in the adapter, and the executable name for each is
overridable through settings (`roster_tool_claude`, `roster_tool_codex`, `roster_tool_antigravity`) for
operators whose binaries are not on `PATH` under the obvious name. Overriding the *path* to a
known tool is not the same as letting agent content choose an arbitrary command.

**The subprocess runs with `cwd` set to the project folder** (spec §3), so relative paths in an
agent's own output mean what the agent thinks they mean.

## 4. Talking to the process

**The three tools do not share an output format**, and none emits roster's shape natively. So each
gets a thin **adapter**: `argv(agent, task)` plus `parse(line) -> (kind, content) | None`. They sit
beside each other in `adapters/agents/tools/`, and adding a fourth tool is a new file plus a table
entry — not a change to the runtime.

The runtime itself knows only: spawn, read lines, hand each to the adapter, yield what comes back.
That split is what stops per-tool quirks leaking into the turn manager.

**Preferred wire format, where a tool offers one: newline-delimited JSON.**

### `claude` — verified 2026-08-10 against the installed binary

`claude -p "<task>" --output-format stream-json --verbose` emits NDJSON. **The earlier draft of
this section invented a `{"kind", "content"}` shape. That shape does not exist.** The real one:

| Line | Maps to |
|---|---|
| `{"type":"assistant","message":{"content":[{"type":"text","text":…}]}}` | `("text", text)` |
| same, content block `{"type":"tool_use","name":"Write"\|"Edit","input":{"file_path":…}}` | `("file_write", file_path)` |
| same, any other `tool_use` | `("event", "used <name>")` |
| `{"type":"result","subtype":"success","result":…}` | terminal; nothing yielded |
| `{"type":"result","is_error":true,…}` | `("event", <the error>)` |
| `{"type":"system",…}`, `{"type":"rate_limit_event"}` | **understood and deliberately ignored** |

That last row is why `parse` returns `(kind, content) | None`: `None` means *recognised and not
worth a message*, which is different from unparseable. Session/hook chatter flooding a thread would
bury the agent's actual work.

**Two things the probe turned up that change other plans.**

1. **The runtime can report tokens and cost.** `message.usage` carries token counts and the
   terminal `result` carries `total_cost_usd` — one trivial call reported `$0.319`. Elsewhere it is
   recorded that "no entity carries a token or spend figure", which is why most of the Dashboard is
   fixtures. That is true of roster's *model*, but the data exists at this boundary. Capturing it
   stays out of scope here, but it is now a known-possible follow-up rather than a missing input.
2. **The spawned CLI inherited this machine's Claude Code hooks**, so the stream opened with four
   `SessionStart` hook lines carrying unrelated content. A spawned agent must not inherit the
   operator's interactive configuration — the subprocess environment needs deciding rather than
   defaulting.

### `codex` — verified 2026-08-15 against codex-cli 0.147.0

Installed and probed. The stream is NDJSON of lifecycle events and shares **no field** with
claude's — claude nests content blocks inside an `assistant` message; codex emits flat
`thread.started` / `turn.started` / `item.started` / `item.completed` / `turn.completed` and carries
the work in `item`. This is the clearest evidence that per-tool adapters were the right shape.

Turn: `codex exec --json --skip-git-repo-check --sandbox workspace-write [--model M] <task>`.
Compaction: the same without `--json`, `--sandbox read-only`, and a trailing `-` — codex's own
"instructions come from stdin". Plain stdout is exactly the answer and nothing else.

| Event | Becomes |
|---|---|
| `item.completed` + `item.type: agent_message` | `("text", item.text)` |
| `item.completed` + `item.type: file_change` | one `("file_write", path)` **per entry in `changes`** |
| `item.completed` + `item.type: command_execution` | `("event", "ran <command>")` |
| `item.completed` + `item.type: error` | `("event", message)` |
| `{"type": "error", "message": …}` (top level) | `("event", message)` |
| `{"type": "turn.failed", "error": {"message": …}}` | `("event", message)` |
| `item.started`, `thread.started`, `turn.started`, `turn.completed` | nothing |
| any other `item.type` | `("event", <the type>)` — a newer codex will emit types roster has not met |

Three things only running it could establish:

- **`item.started` must be silent.** Every item is reported twice, so honouring both would double
  every file write and every command in the thread.
- **One event can be several messages.** An `apply_patch` touching three files is one `file_change`
  carrying three paths, which is why `parse` returns a *list*. Returning the first would drop the
  rest — and the same bug was already latent in the claude adapter, which returned at the first
  interesting content block and so hid the edit that followed an explanation.
- **`--skip-git-repo-check` is mandatory.** codex refuses to run in a directory that is not a
  trusted git repository, and a roster project frequently is not one: source kind `none` creates a
  plain folder. Without it the turn dies before the agent sees the task.

**`--model` is passed only when the operator chose one.** `Agent.model` falls back to a *claude*
model, which is meaningless to codex; and forcing any model overrides codex's account-aware default
— `--model gpt-5-codex` failed with "not supported when using Codex with a ChatGPT account" on an
account where omitting it worked.

### `antigravity` (`ayg`) — not installed, no adapter

**Replaces gemini in the enum (2026-08-16).** Google's CLI for this is now
antigravity, which ships as **`ayg`** rather than under its own name — so the
`tool` value is `antigravity` and `roster_tool_antigravity` defaults to `ayg`.

The binary is **not installed on this machine**, so nothing here describes its
output. Two things must not be inferred:

- **Its stream format.** Every other adapter in this document was written from a
  probe of the real binary, and the one that was not — claude's first mapping —
  was wrong in every field. There is no help text to lean on either, since the
  command is absent.
- **Which models it accepts.** `tool_for_model` maps the `gemini` model prefix to
  antigravity on the reasonable assumption that Google's models run under
  Google's tool. That is an assumption, marked as one in the code, and the first
  thing to check when the binary arrives.

A `tool` with no adapter already disables the agent with a readable reason (§5),
so shipping two adapters is a coherent state rather than a half-built one.

## 5. Failure, and what it must never do

Spec §7: a subprocess that exits non-zero, times out, or cannot be spawned posts an `event`
message carrying the reason, and the thread stays open for a retry.

| Failure | Behaviour |
|---|---|
| Non-zero exit | final `event`: `agent exited with status <n>` |
| Cannot spawn (`FileNotFoundError`) | `event` naming the tool and the executable it looked for — "codex is not installed or not on PATH" is actionable; "spawn failed" is not |
| Exceeds `roster_agent_timeout_seconds` (default 900) | terminate, then kill after a grace period; `event` says which |
| Killed by a signal | `event` naming the signal |

**The subprocess is terminated when its asyncio task is cancelled.** `AgentTurnManager.drain()`
exists because a turn outliving its loop corrupts teardown; a subprocess outliving its turn is the
same defect with a heavier object. Cancellation must reach the process group, not just the direct
child — the same lesson `make dev` needed twice.

**A disabled agent is never spawned.** `read_agent` degrades a broken folder to Disabled with a
reason; `execute` raises before spawning if `agent.status == "disabled"`, so a malformed
`config.yaml` cannot reach an exec call.

## 6. Memory

Spec §5's read path is already specified and unchanged: at turn start the manager injects
`MEMORY.md` plus unfolded journal entries, and exports `ROSTER_PROJECT_MEMORY`. This runtime
passes both through the environment rather than on the command line — a digest is up to 8 KB and
argument lists have limits.

`summarise` invokes the same CLI in a non-interactive mode with the digest and entries on stdin,
using the agent's configured model. It returns the replacement digest as plain text. A non-zero
exit raises, which `compact_now` already turns into a failed compaction that leaves digest and
journal untouched — the existing contract needs no change.

An **empty** result is refused rather than written. `compact()` deletes the journal entries it
folded in, so accepting an empty digest would erase a project's accumulated context irrecoverably;
refusing makes that loss impossible rather than merely unlikely.

> **Closed 2026-08-16.** Compacting through the real CLI produced a line that was in no input given
> to it — "Python/FastAPI server at `projects/server`" — because the compaction subprocess inherited
> the server's working directory and the CLI read the files it found there. For a *project's* memory
> that is at best the wrong project's context.
>
> `AgentRuntime.summarise` now takes `project_folder`, which `compact_now(folder, agent)` always had
> and simply did not pass on, and `SubprocessRuntime` spawns compaction with that as its cwd and the
> same stripped environment a turn gets. Verified by compacting a throwaway project through the real
> binary: the digest describes that project and mentions nothing of roster's own tree.
>
> Widening the port was the honest fix rather than the cheap one — `FakeRuntime` implements it too —
> which is why it was held back to its own change instead of being smuggled in beside the feature
> that revealed it.

## 7. Out of scope, deliberately

- **Lead-agent coordination.** Spec §3 says the lead spawns and messages other agents through the
  turn manager. What it *sends*, and how a sub-agent's output returns to the lead's thread, is
  undesigned. It needs its own spec and should not be inferred from this one.
- **Cloning a remote git source.** Spec §12 ties this to `SubprocessRuntime`; it is a separate
  change once a working tree is genuinely needed.
- **Sandboxing and egress control.** Spec §10 rules these out by design: local trust model.
- **Token and spend accounting.** No entity carries one (§4 of the UI gap notes). If the CLI
  reports usage, capturing it is a follow-up that adds a field, not part of this runtime.

## 8. Done means

- `SubprocessRuntime` implements `AgentRuntime` and is selected by `deps._build_runtime` when
  `roster_use_subprocess_runtime` is set; `FakeRuntime` remains the default so tests and
  `make dev` are unchanged.
- Adapters exist for `claude`, `codex` and `antigravity`, each with its argv and parser in its own file,
  and each with a test against its real binary that skips when the binary is absent.
- An unknown `tool` value disables the agent with a readable reason rather than raising.
- The model-prefix inference is tested for all three families, and an explicit `tool` overrides it.
- Every failure in §5 has a test asserting the `event` message reaches the thread.
- A malformed JSON line, a `kind`-less line, and stderr each have a test.
- Cancelling a turn kills the process group — asserted, not assumed.
- A disabled agent is never spawned — asserted.

### Status, 2026-08-10

Everything above holds except the adapters, which are one of three.

- **`claude`: done**, against the installed binary — a full turn answered in a thread, resolving
  wrote the journal entry, and a real compaction folded an entry into the digest.
- **`codex`: done (2026-08-15)**, against codex-cli 0.147.0. A live turn through roster wrote a file
  and answered in the thread. Two defects surfaced only by running it: roster handed every turn the
  *server's stdin*, which codex reads and claude ignores, so the turn died before the agent saw the
  task; and `parse` could return only one message per line, which would have dropped every file
  after the first in a multi-file patch.
- **`antigravity` (`ayg`): blocked, and now the third tool in the enum** — it replaced gemini on
  2026-08-16. The binary is not installed, so its real output has never been seen, and §4 records
  why writing an adapter from anything less is the specific mistake this spec already made twice.
- **The compaction cwd leak is closed** (§6). `summarise` receives the project folder and runs
  there.
- **Termination is asserted against a process that ignores `SIGTERM`**, in both the turn and
  compaction paths. Compaction previously signalled its child and raised without waiting, so only
  the turn path escalated to `SIGKILL` — a CLI that traps `SIGTERM` survived a compaction timeout
  outright, and the unwaited transport surfaced as an intermittent "Event loop is closed".
- **An end-to-end journey exists** (`tests/e2e/test_journey.py`), booting a real uvicorn against a
  temporary data root and walking design spec §12 over HTTP. A browser-level journey is still
  blocked on a Playwright bridge, so the screens remain covered only by component tests.
