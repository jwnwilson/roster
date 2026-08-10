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
tool: claude        # claude | codex | gemini
token_limit: 200000
```

`tool` is a **closed enum, not a command string.** Roster maps the name to an argv it builds
itself. This is the whole security property: an agent folder is operator content, and a folder
that could name an arbitrary command would let a malformed `config.yaml` execute anything —
turning "a broken folder degrades to Disabled" (spec §7) from a robustness feature into a security
boundary it was never designed to be. A name roster does not recognise is a **Disabled agent with
a readable reason**, exactly like a malformed `token_limit` today.

Defaulting: `tool` is optional and inferred from the model prefix (`claude-*` → `claude`,
`gpt-*`/`o[0-9]*` → `codex`, `gemini-*` → `gemini`), so existing agent folders keep working
untouched. An explicit `tool` always wins over the inference.

Each tool's argv lives in one table in the adapter, and the executable name for each is
overridable through settings (`roster_tool_claude`, `roster_tool_codex`, `roster_tool_gemini`) for
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

**Preferred wire format, where a tool offers one: newline-delimited JSON.** All three can emit
structured streaming output, and where a tool supports it the adapter requests it and parses it.
One object per line:

```json
{"kind": "text", "content": "Read 42 lines of src/auth/token.py"}
{"kind": "file_write", "content": "src/auth/token.py", "payload": {"lines_added": 12}}
{"kind": "question", "content": "Should the summary cover the tests as well?"}
```

- **A line the adapter cannot parse is yielded as `("event", <the raw line>)`,** never dropped. An
  agent that prints a stack trace to stdout must not vanish; spec §7 says a failure is visible in
  the UI, never silent. This is also the fallback for a tool run in plain-text mode: its output
  still reaches the thread, just untyped.
- **A line missing `kind` is treated as `text`.** The common case should not need ceremony.
- **stderr is streamed as `event` messages**, interleaved by arrival. An agent's diagnostics are
  part of the record of what it did.

Rejected: parsing free text with heuristics to recover `kind`. Roster would be guessing what an
agent meant, and guessing wrong is indistinguishable from the agent having said something else.
Untyped-but-honest beats typed-but-invented.

**Unverified, and the first thing to check when implementing:** the exact streaming-output flag and
JSON shape for each of `claude`, `codex` and `gemini`. They differ, they change between versions,
and this spec deliberately does not guess at them — each adapter's first test should run its real
binary if present and be skipped if not, so the table is grounded in what the tools actually emit
rather than what this document assumed.

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
- Adapters exist for `claude`, `codex` and `gemini`, each with its argv and parser in its own file,
  and each with a test against its real binary that skips when the binary is absent.
- An unknown `tool` value disables the agent with a readable reason rather than raising.
- The model-prefix inference is tested for all three families, and an explicit `tool` overrides it.
- Every failure in §5 has a test asserting the `event` message reaches the thread.
- A malformed JSON line, a `kind`-less line, and stderr each have a test.
- Cancelling a turn kills the process group — asserted, not assumed.
- A disabled agent is never spawned — asserted.
