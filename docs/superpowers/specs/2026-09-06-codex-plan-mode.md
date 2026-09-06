# Plan mode for Codex agents

A plan, not an implementation. Written 2026-09-06, against `main` at `5c9bbe3`.

Answers the TODO line *"Verfiy the plan visualisation is working for all
models"* — or rather, the defect that verifying it uncovered. The verification
itself is PR #67, whose tests pin every claim in section 0 below.

## 0. What is actually broken

The TODO assumes the visualisation is the doubtful part. It is not. **The
visualisation already works for every runner, and a Codex agent has nothing to
show it.**

Three findings, in the order they bite:

**A Codex agent can never enter plan mode.** `StartOptions.planMode` exists
(`electron/main/runners/types.ts:81`) and `ClaudeRunner` honours it by mapping
it to the SDK's own plan permission mode:

```ts
// electron/main/runners/claude.ts:76
permissionMode: options.planMode === true ? 'plan' : 'default',
```

`CodexRunner.run` (`electron/main/runners/codex.ts:81`) never reads the field.
The argv it builds is byte-identical with and without it.

**Even if it did, the capture site could not fire.** Roster captures a plan by
recognising one tool name:

```ts
// electron/main/sessions/manager.ts:611
event.name === EXIT_PLAN_MODE ? planFromToolInput(event.input) : null
```

That depends on the runner emitting a `tool` event named `ExitPlanMode`.
`normalizeCodex.ts` emits exactly two tool names — `shell` and `edit` — and
drops everything else:

```ts
// electron/main/runners/normalizeCodex.ts:80
default:
  return []
```

MCP tool calls are among the dropped. So **no tool name, however chosen, can
reach the capture site from Codex.** This is the single most important fact in
this document: it rules out the obvious fix of teaching Codex to emit
`ExitPlanMode`, and it decides section 2.

**The half that already works.** A Codex agent *can* record a plan's pull
request: `mcp__plans__record_pull_request` reaches it over the stdio bridge
added in PR #56, is included in the bridge's tool set
(`electron/main/runners/toolDefinitions.ts:80`) and is auto-approved as
non-destructive. PR #67 proved this end-to-end over the real socket.

So today a Codex agent can close a plan it is incapable of opening.

**And the visualisation is genuinely runner-neutral.** `Plan`, `PlanDocument`
and `PlanComment` (`shared/types.ts`) carry no runner field; the renderer never
reads `agent.runner`. Nothing downstream of capture needs to change. Give Codex
a way to produce a plan and the rest of the feature is already built.

## 1. Decisions taken

| Question | Decision | Why |
|---|---|---|
| Does proposing block the agent, as it does for Claude? | **No — propose, then end the turn.** | `CodexRunner.respondToApproval` is a deliberate no-op; there is no callback to release. Holding would mean Roster owning the lifetime of an idle `codex exec` process for as long as a human takes to read. |
| Is "research only" enforced or merely requested? | **Enforced, via a read-only sandbox.** | For Claude, plan mode *refuses* every edit. A Codex plan mode that only asked politely would rebuild the same asymmetry this work exists to remove. |
| How far does the change reach? | **Codex only.** | Custom runners are broken in a related way (section 8). Fixing them is a second subsystem, not this one. |
| How does the plan leave the process? | **A `propose_plan` MCP tool.** | Forced by the normalizer finding above, and consistent with how Roster already takes structured facts from agents. |

The rejected alternative worth recording: Codex's `--output-schema` can
constrain the final message to a JSON shape, which would *guarantee* a
well-formed plan where a tool call only invites one. It was rejected because it
consumes the final message — the prose the user reads in the chat pane would
become JSON — and because it is a per-invocation flag whose survival across
`exec resume` is unverified, where every revision turn is a resume. Its failure
mode is silent; the chosen approach's failure mode is visible.

## 2. The mechanism: `propose_plan`

Capture happens **in the tool handler, in the main process** — not in the event
stream. This is forced by the normalizer, and it is better regardless: it
depends on no CLI's event vocabulary, so it works identically for anything
reached over the bridge.

`PlanTools` (`electron/main/runners/planTools.ts:13`) gains one method:

```ts
export interface PlanTools {
  /** Present a plan for review, ending the research turn that wrote it. */
  propose(body: string): Plan
  recordPullRequest(planId: string, input: { url: string; branch?: string }): Plan
}
```

`PLAN_TOOL_NAMES` (`planTools.ts:24`) gains `mcp__plans__propose_plan`. That
list is not decoration — its own comment warns that a name missing from it does
not fail loudly but blocks on the approval gate forever.

The handler calls the same primitive the Claude path uses,
`PlanStore.capture` (`electron/main/store/plans.ts:120`), reached today through
`SessionManager.capturePlan` (`manager.ts:828`):

```ts
plans.capture({ sessionId, agentId, body })
```

A Codex plan is therefore the same row, written by the same code, with its
title derived from the opening heading exactly as before. That is what makes
the visualisation work for free rather than by a second implementation.

**The tool's argument is named `plan`,** matching `ExitPlanMode`'s key, so the
two runners describe the same idea with the same word.

Note that it is *not* validated by `planFromToolInput` (`shared/plans.ts:19`).
That function parses a raw JSON string out of a tool **event**, which is what
the Claude path receives; a bridge tool's arguments arrive already parsed and
are validated in the main process by zod, like every other bridge argument
(`electron/main/runners/mcpBridge.ts:162`). The two paths share the argument's
name and its meaning, not its parser — and `planFromToolInput` keeps exactly
the callers it has today.

**One signature change.** `planToolsFor(agent)` (`manager.ts:819`) becomes
`planToolsFor(agent, session)`: proposing needs session identity where
recording did not. Its only caller, `builtinToolsFor(agent, session)`
(`manager.ts:865`), already holds both.

**Enablement.** `planToolsFor` currently returns `undefined` unless the agent
has enabled the plans server in its own `mcp_servers`. When `planMode` is on,
the plans tool set is provided regardless. This overrides the codebase's
opt-in principle deliberately, and narrowly:

- Claude's plan mode needs no MCP server at all, so requiring a Codex user to
  enable one would recreate the same silent-nothing trap in a new place — the
  toggle would appear to work and do nothing.
- Toggling plan mode *is* the opt-in, and it is narrower than enabling the
  server permanently: it lasts one turn.

There is a third clause, added while writing the implementation plan. Plan mode
alone is not enough, because the **build** turn is not a plan-mode turn: an
agent that proposed a plan without the server enabled would reach the build turn
without `record_pull_request`, never report its pull request, and have
`settleBuild` cycle the plan back to draft — the exact trap this work closes. So
the gate is: the agent enabled the server, **or** this is a planning turn, **or**
this session already has a plan. Outside those, nothing changes.

## 3. The planning turn

`CodexRunner.run` reads `options.planMode` and changes two things.

### Permissions

A `codexPlanPermissions()` beside the existing `codexPermissionOverrides`
(`codex.ts:146`), using the same profile mechanism:

```
default_permissions="roster-plan"
permissions.roster-plan.extends=":read-only"
permissions.roster-plan.network.enabled=true
```

No `filesystem` key, so nothing is writable.

The profile is kept rather than replaced by the simpler `--sandbox read-only`
flag for one reason: the existing builder deliberately enables network
(`codex.ts:158`) so commands can resolve DNS and reach the internet, and
research is precisely the turn that needs it. The bare flag would take that
away silently. Same mechanism, one fewer capability.

Both builders emit `--config` overrides, and `codex.ts:89-92` already repeats
those on `exec resume`, so a revision turn stays read-only without further
work.

### Prompt

A `planInstruction()` added to `electron/main/sessions/planPrompt.ts`, which
already owns every other plan-related string, appended through the existing
`composePrompt` (`codex.ts:218`).

**`revisePrompt` also has to change**, which this document originally missed.
`planPrompt.ts:55` reads *"Stay in plan mode: present the revised plan with
ExitPlanMode when it is ready."* — and every revision turn goes through it, for
every runner, so a Codex agent would be told to call a tool it does not have.
The wording becomes tool-neutral and each runner's own instruction names the
mechanism. `reviseReason` (`planPrompt.ts:78`) keeps its wording: it is only
ever sent as the refusal of a live `ExitPlanMode` call, which is Claude-only by
construction.

It must carry the one thing the agent cannot discover for itself: that it
cannot write, and that the turn ends by calling `mcp__plans__propose_plan`.
This string is load-bearing — it is the whole of the chosen approach's
reliability — and is tested as such (section 6).

## 4. The lifecycle after the proposal

**`PlanFlow` needs no changes.** Checked, not assumed:

- **Revise.** `blockedOnPlan` looks for a pending `ExitPlanMode` approval.
  For Codex there is never one, so `submit()` takes its already-designed
  non-blocked branch: `enqueue(..., revisePrompt(input), { planMode: true })`
  (`planFlow.ts:85`). The revision turn is therefore read-only too.
- **Approve.** `planFlow.ts:127` calls `enqueue(plan.sessionId,
  buildPrompt(...))` unconditionally, outside the `if (blocked)`, and with **no**
  `planMode`. The build turn is write-enabled and lands on `branchFor(plan)`.
- **Close.** `record_pull_request` already works over the bridge.
- **`settleBuild`** (`manager.ts:527`) stops being a trap: a Codex plan can now
  reach `prUrl`, so it no longer cycles draft → building → draft.

The accepted cost of the propose-then-end decision: a Codex revision spends a
turn, where Claude's answers the live call for free. It keeps its CLI thread
through `resumeFrom`, so it does not re-read the repository from scratch.

## 5. Changes, file by file

| File | Change |
|---|---|
| `electron/main/runners/planTools.ts` | `propose` on the interface; the tool; the name in `PLAN_TOOL_NAMES` |
| `electron/main/sessions/manager.ts` | `planToolsFor(agent, session)`; wire `propose`; provide plan tools when `planMode` is on |
| `electron/main/runners/codex.ts` | Read `options.planMode`; add `codexPlanPermissions()`; append the plan instruction |
| `electron/main/sessions/planPrompt.ts` | `planInstruction()`; make `revisePrompt` tool-neutral |
| `tests/main/` | Section 6 |

No renderer change. No store change. No migration. No change to `PlanFlow`,
`shared/plans.ts`, `shared/types.ts` or `normalizeCodex.ts`.

The implementation plan for this spec is
`docs/superpowers/plans/2026-09-06-codex-plan-mode.md`.

## 6. Testing

Tests first, per `AGENTS.md`. The suite additions that earn their place:

1. **The bridge call, end to end.** A `propose_plan` call over the real unix
   socket lands a plan row. PR #67 established this harness for
   `record_pull_request`; this is the same shape.
2. **Planning argv is read-only.** A `planMode` turn's argv contains the
   read-only profile and no writable filesystem entry; a build turn's contains
   the worktree profile. This is the test that would have caught the original
   defect, inverted from PR #67's negative.
3. **Enforcement, not just configuration.** A real Codex invocation under the
   plan profile is *refused* when it attempts a write. Distinct from 2 on
   purpose: 2 proves Roster asks for the right thing, this proves Codex honours
   it. See the risk in section 7.
4. **Runner-indistinguishable output.** A plan proposed by Codex and one
   captured from Claude produce rows that differ only in `sessionId`/`agentId`.
5. **Enablement.** Plan mode on an agent without the plans server still gets
   the tool; `record_pull_request` still does not.
6. **The lifecycle.** Revise enqueues a read-only turn; approve enqueues a
   write-enabled one; `settleBuild` no longer fires on a plan that reached
   `prUrl`.
7. **The prompt.** The plan instruction names the tool. A weak assertion, but
   the failure it guards against — a rewrite that quietly drops the sentence,
   leaving an agent that plans and never proposes — is silent otherwise.

## 7. Risks and open questions

**The read-only profile is proven.** ~~Validated but not proven.~~ Verified
against codex 0.149.0 on 2026-09-06: a run under
`permissions.roster-plan.extends=":read-only"` was asked to create a file and
refused it — `zsh:1: operation not permitted: out.txt`, directory left empty.
`:read-only` is a valid profile base; `--strict-config` accepts it. **The
fallback below is therefore not needed**, and is kept only as the record of what
would have happened otherwise: `--sandbox read-only` with network access lost,
a trade-off that would have gone back to the user rather than being taken
silently.

**Network under a read-only profile works.** Also verified on the same run:
`curl https://example.com` returned 200 under the planning profile with
`network.enabled=true`. This is what justifies §3's choice to keep the profile
mechanism rather than the bare `--sandbox read-only` flag — research turns keep
the internet.

**The agent may simply not call the tool.** The chosen approach invites a
proposal where `--output-schema` would compel one. A planning turn that ends
with no proposal should leave a comment on the session saying so, rather than
ending in silence that looks like success. Worth deciding before implementation:
this document proposes the comment, and does not specify its wording.

## 8. Deliberately not in scope

- **Custom runners.** `CustomRunner` ignores `options.mcpServers` entirely, so
  it cannot be given the bridge without building one for it, and it ignores
  `options.resumeFrom` as well. Its plans are captured today only because
  `manager.ts:611` gates on a tool *name* rather than a runner, and they can
  never be built, so they cycle draft → building → draft. Real, known, and a
  separate piece of work.
- **Agent-to-agent plan review.** Whether one agent can send another's plan
  back belongs with the mention-chain work in PRs #62 and #63.
- **Any change to how plans render.** There is nothing wrong with it.
