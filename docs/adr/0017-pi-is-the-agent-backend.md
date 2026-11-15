# 0017 — Pi is the agent backend

**Status:** Accepted (prototype)

## Context

Roster drove two CLIs, Claude Code (Agent SDK, in process) and Codex
(`codex exec`, a subprocess), plus custom argv runners. Every feature was built
once per CLI and degraded differently: approvals (`canUseTool` vs Roster's MCP
decision tool, ADR 0005), Roster's own tools (in-process MCP vs the stdio bridge),
plan mode (`ExitPlanMode` vs `propose_plan`), spend (exact vs estimated, ADR 0002).

Pi (`@earendil-works/pi-coding-agent`) is an agent harness with a TypeScript SDK
that reaches the same providers — including Anthropic and OpenAI subscription
logins — and exposes, in process: an event stream, a `tool_call` hook that can
block, plain-function custom tools, MCP, skills, persistent session files, and
per-message usage with cost.

## Decision

Every agent runs on Pi, through `PiRunner` (`electron/main/runners/pi/`), in the
Electron main process. Roster is the UI and orchestration layer: roster, board,
plans, handoffs, approvals, spend.

- **Approvals:** an inline extension's `tool_call` handler awaits the user for
  anything but `read`/`grep`/`find`/`ls` and Roster's own tools.
- **Roster tools** are `builtinToolDefinitions` handed to Pi as custom tools; no
  MCP bridge.
- **User MCP servers** go through Pi's MCP extension with `direct` exposure.
- **Skills** are the agent's enabled skill folders; Pi's own discovery is off.
- **Plan mode** restricts tools to read-only plus `propose_plan`.
- **Resume** uses the Pi session file path as `runnerSessionId`; files live in
  `~/roster/pi-sessions/`.
- **Credentials** are Pi's (`~/.pi/agent/auth.json`); sign in with `pi` → `/login`.
- Existing agents are migrated on load to `runner = "pi"`, with Claude models
  mapped to `anthropic/…` and Codex models to `openai-codex/…`.

## Consequences

- One code path for every provider; exact spend everywhere.
- Codex's OS sandbox is gone: Pi tools run with Roster's permissions, gated only
  by approvals. Isolation (containers, Gondolin) is follow-up work.
- Pi runs in Roster's process; a misbehaving tool can affect the app. A
  `utilityProcess` host is the fallback if that bites.
- Claude/Codex adapter code is now dead and is removed in a follow-up once the
  Pi path has shipped.
- Custom argv runners are retired; Pi providers/extensions replace them.
