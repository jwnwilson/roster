# Codex Plan Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Codex agent research under a read-only sandbox and present a plan for review, so the plan feature works for Codex agents and not only Claude ones.

**Architecture:** A `propose_plan` tool is added to the existing `plans` MCP server. A Codex agent reaches it over the stdio bridge built in PR #56, and the handler captures the plan in the main process — *not* from the event stream, because `normalizeCodex.ts:80` drops every item type it does not recognise, MCP tool calls included. Planning turns additionally run under a read-only Codex permission profile, so "research only" is enforced the way the Claude SDK enforces it rather than merely requested.

**Tech Stack:** Electron main process, TypeScript, Vitest (`npm test`), zod for tool schemas, `better-sqlite3` via `PlanStore`. Tests import main-process code through the `@main/` alias.

**Spec:** `docs/superpowers/specs/2026-09-06-codex-plan-mode.md`

## Global Constraints

- **Every task gets its own worktree, branch and PR.** Never commit to `main`, never push to `origin/main`. See `AGENTS.md`. If executing this plan as one piece of work, one worktree and one PR for the whole plan is correct; the per-task commits below stack inside it.
- **`npm install` before anything runs** in a fresh worktree — `postinstall` rebuilds `better-sqlite3` and `node-pty` against Electron's ABI.
- **`npm run check` must pass before the PR** — typecheck, coverage and build. Thresholds from `vitest.config.ts`: **80% statements, 80% lines, 80% functions, 70% branches.**
- **Tests first.** Write the failing test, watch it fail, then implement.
- **Immutability**: build new objects, never mutate arguments in place.
- **Runner scope: Codex only.** Do not touch `CustomRunner` — its gaps are recorded in §8 of the spec and are separate work.
- **Do not change the renderer, the store schema, or `normalizeCodex.ts`.** No migration is required by this plan.

---

## Corrections to the spec, discovered while writing this plan

Two things the spec did not account for. Both are handled by tasks below; the
spec should be amended to match.

**1. `revisePrompt` hardcodes Claude's tool.** `electron/main/sessions/planPrompt.ts:55`
reads *"Stay in plan mode: present the revised plan with ExitPlanMode when it is
ready."* Every revision turn goes through this string, for every runner. A Codex
agent would be told to call a tool it does not have. Task 4 makes the wording
tool-neutral and moves the naming of the mechanism into each runner's own
instruction. `reviseReason` (`planPrompt.ts:78`) keeps its `ExitPlanMode`
wording, because it is only ever sent as the refusal of a live `ExitPlanMode`
call, which is Claude-only by construction.

**2. Forcing the plans server on for plan mode would create a new trap.** The
spec says plan mode provides the plan tools regardless of `agent.mcpServers`,
and that `record_pull_request` "stays gated exactly as it is today". Those two
together break the build turn: an agent without the plans server enabled would
propose a plan, be approved, and then reach the *build* turn — which is not plan
mode — without `record_pull_request`. It could never report its PR, so
`settleBuild` (`manager.ts:527`) would cycle it draft → building → draft. That
is precisely the trap this work exists to close.

The gate in Task 2 is therefore: the agent enabled the plans server, **or** this
is a plan-mode turn, **or** this session already has a plan. The third clause is
what carries the build turn.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `electron/main/runners/planTools.ts` | The `plans` MCP tools and their schemas | Add `propose` to the interface, the `propose_plan` tool, and its name to `PLAN_TOOL_NAMES` |
| `electron/main/sessions/manager.ts` | Decides which built-in tools a session holds | `planToolsFor` gains session + plan-mode awareness and wires `propose` |
| `electron/main/runners/codex.ts` | Builds `codex exec` argv | Read `options.planMode`; add `codexPlanPermissions()`; append the plan instruction |
| `electron/main/sessions/planPrompt.ts` | Every plan-related prompt string | Add `planInstruction()`; make `revisePrompt` tool-neutral |
| `tests/main/planTools.test.ts` | Tool handlers against a real store | Extend |
| `tests/main/codexPlanMode.test.ts` | **New** — argv and sandbox for planning turns | Create |
| `tests/main/planRunnerReach.test.ts` | Per-runner reach of the plan path | Extend (created by PR #67; create it if that PR has not merged) |

---

### Task 1: The `propose_plan` tool

**Files:**
- Modify: `electron/main/runners/planTools.ts`
- Test: `tests/main/planTools.test.ts`

**Interfaces:**
- Consumes: `PlanStore.capture({ sessionId, agentId, body })` (`electron/main/store/plans.ts:120`), which returns a `Plan`.
- Produces: `PlanTools.propose(body: string): Plan`; the tool `propose_plan`; `PROPOSE_PLAN_SCHEMA`; `PLAN_TOOL_NAMES` becomes `['mcp__plans__propose_plan', 'mcp__plans__record_pull_request']`.

- [ ] **Step 1: Write the failing tests**

In `tests/main/planTools.test.ts`, add `propose` to the `PlanTools` fixture inside `handlers()` (it currently supplies only `recordPullRequest`):

```ts
  const tools: PlanTools = {
    propose: (body) => plans.capture({ sessionId: 's1', agentId: 'debugging', body }),
    recordPullRequest: (planId, input) => plans.recordPullRequest(planId, input),
  }
```

Update the existing allowlist test, which asserts exact arrays:

```ts
    expect(PLAN_TOOL_NAMES).toEqual([
      'mcp__plans__propose_plan',
      'mcp__plans__record_pull_request',
    ])
    expect([...handlers().keys()]).toEqual(['propose_plan', 'record_pull_request'])
```

Add a new describe block. Note `aPlan()` already inserts session `s1`; call it or insert the session directly before proposing, because `plans.capture` writes a row with a foreign key to it:

```ts
describe('an agent presenting a plan', () => {
  function proposePlan(): (args: never) => Promise<ToolResult> {
    const handler = handlers().get('propose_plan')
    if (!handler) throw new Error('propose_plan was never built')
    return handler
  }

  test('captures the plan and names it back so the agent knows it landed', async () => {
    // Arrange
    aPlan()

    // Act
    const result = await proposePlan()({ plan: '# Add a cache\n\nThe details.' } as never)

    // Assert
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('Add a cache')
    expect(plans.listBySession('s1').map((plan) => plan.title)).toContain('Add a cache')
  })

  test('tells the agent to stop rather than carry on into the work', async () => {
    aPlan()

    const result = await proposePlan()({ plan: '# Do it\n\nHow.' } as never)

    expect(result.content[0].text).toMatch(/stop/i)
  })

  test('refuses an empty plan with something the agent can act on', async () => {
    aPlan()

    const result = await proposePlan()({ plan: '   ' } as never)

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('plan')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/planTools.test.ts`
Expected: FAIL — `propose_plan was never built`, and the allowlist test fails on the array comparison.

- [ ] **Step 3: Implement the tool**

In `electron/main/runners/planTools.ts`, extend the interface:

```ts
export interface PlanTools {
  /**
   * Present a plan for review, ending the research turn that wrote it.
   *
   * The session is bound by the caller rather than passed as an argument:
   * which session a plan belongs to is Roster's fact, not the agent's to
   * choose.
   */
  propose(body: string): Plan

  recordPullRequest(planId: string, input: { url: string; branch?: string }): Plan
}
```

Extend the allowlist, in the order the agent uses them:

```ts
export const PLAN_TOOL_NAMES = [
  'mcp__plans__propose_plan',
  'mcp__plans__record_pull_request',
] as const
```

Add the schema beside `RECORD_PR_SCHEMA`:

```ts
export const PROPOSE_PLAN_SCHEMA = {
  plan: z
    .string()
    .describe(
      'The plan itself, as Markdown. Open with a heading naming what you propose to do — ' +
        'that heading becomes the plan’s title.',
    ),
}
```

Add the tool inside `buildPlanTools`, before `recordPullRequest`, and return both:

```ts
  const proposePlan = tool(
    'propose_plan',
    'Present your plan for review and end the turn. Call this once your research is done. Do not start the work.',
    PROPOSE_PLAN_SCHEMA,
    async (args: { plan: string }) => {
      const body = args.plan.trim()
      if (body === '') {
        return text('A plan cannot be empty. Put the plan itself in `plan`.', true)
      }

      const plan = plans.propose(body)
      return text(
        `Presented "${plan.title}" for review. Stop here — you will be told whether to build it.`,
      )
    },
  )

  return [proposePlan, recordPullRequest]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/planTools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/main/runners/planTools.ts tests/main/planTools.test.ts
git commit -m "feat: add a propose_plan tool to the plans server"
```

---

### Task 2: Give the session's plan tools a session, and a plan-mode gate

**Files:**
- Modify: `electron/main/sessions/manager.ts` (`planToolsFor`, `builtinToolsFor`)
- Test: `tests/main/planRunnerReach.test.ts`

**Interfaces:**
- Consumes: `PlanTools.propose` from Task 1; `PlanStore.listBySession(sessionId): Plan[]` (`electron/main/store/plans.ts:90`).
- Produces: `planToolsFor(agent: Agent, session: Session, planMode: boolean): PlanTools | undefined`.

- [ ] **Step 1: Write the failing tests**

`builtinToolsFor` is private, so drive this through the public `send`, the way `tests/main/planRunnerReach.test.ts` and `tests/main/codexSessionTools.test.ts` already do — assert on the tool names the bridge is started with. Add:

```ts
test('a codex agent in plan mode is given propose_plan even without the plans server', async () => {
  // Arrange: an agent that has NOT enabled "plans" in its mcpServers.
  const { manager, session } = await codexSessionFor({ mcpServers: [] })

  // Act
  await manager.send(session.id, 'research it', { planMode: true })

  // Assert
  expect(bridgeToolNames()).toContain('propose_plan')
})

test('a codex agent outside plan mode with no plans server gets neither plan tool', async () => {
  const { manager, session } = await codexSessionFor({ mcpServers: [] })

  await manager.send(session.id, 'do it')

  expect(bridgeToolNames()).not.toContain('propose_plan')
  expect(bridgeToolNames()).not.toContain('record_pull_request')
})

test('a session that already has a plan keeps the plan tools on its build turn', async () => {
  // The build turn is not plan mode. Without this the agent could never
  // report its pull request, and settleBuild would cycle the plan back to
  // draft — the exact trap this work closes.
  const { manager, session, plans } = await codexSessionFor({ mcpServers: [] })
  plans.capture({ sessionId: session.id, agentId: session.agentId, body: '# Done\n' })

  await manager.send(session.id, 'build it')

  expect(bridgeToolNames()).toContain('record_pull_request')
})
```

Reuse the fixtures already in that file. If PR #67 has not merged, build `codexSessionFor` the way `tests/main/codexSessionTools.test.ts` does: a stub runner with `Object.setPrototypeOf(stub, CodexRunner.prototype)` so the `instanceof` branch at `manager.ts:395` is genuinely taken, and capture the definitions passed to `McpBridge.start`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/planRunnerReach.test.ts`
Expected: FAIL — `propose_plan` is not in the bridge's tool names, because `planToolsFor` returns `undefined` for an agent without the plans server.

- [ ] **Step 3: Implement**

In `electron/main/sessions/manager.ts`, replace `planToolsFor`:

```ts
  /**
   * The plan tools for this agent, or nothing.
   *
   * Three ways in, because plan mode has to work without ceremony:
   *
   * - the agent enabled "plans", the ordinary opt-in;
   * - this is a planning turn — for a Claude agent plan mode needs no MCP
   *   server at all, so demanding one here would make the toggle appear to
   *   work and do nothing;
   * - the session already has a plan, which is what carries the *build*
   *   turn. That turn is not plan mode, and without this clause an agent
   *   could propose a plan it was then unable to report a pull request for,
   *   leaving settleBuild to cycle it back to draft forever.
   */
  private planToolsFor(
    agent: Agent,
    session: Session,
    planMode: boolean,
  ): PlanTools | undefined {
    const plans = this.plans
    if (!plans) return undefined

    const enabled =
      agent.mcpServers.includes(PLANS_SERVER) ||
      planMode ||
      plans.listBySession(session.id).length > 0
    if (!enabled) return undefined

    return {
      propose: (body) => plans.capture({ sessionId: session.id, agentId: agent.id, body }),
      recordPullRequest: (planId, input) => plans.recordPullRequest(planId, input),
    }
  }
```

Thread the two new arguments through `builtinToolsFor`. Change its signature and the `plans` line:

```ts
  private builtinToolsFor(agent: Agent, session: Session, planMode: boolean): BuiltinToolSet {
```

```ts
    const plans = this.planToolsFor(agent, session, planMode)
```

And its single call site inside `send` (`manager.ts:388`):

```ts
      const toolSet = this.builtinToolsFor(agent, session, options.planMode === true)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/planRunnerReach.test.ts tests/main/codexSessionTools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/main/sessions/manager.ts tests/main/planRunnerReach.test.ts
git commit -m "feat: bind the plan tools to a session and open them in plan mode"
```

---

### Task 3: The read-only planning sandbox

**Files:**
- Modify: `electron/main/runners/codex.ts`
- Test: `tests/main/codexPlanMode.test.ts` (create)

**Interfaces:**
- Consumes: `StartOptions.planMode` (`electron/main/runners/types.ts:81`), already passed through by `manager.ts`.
- Produces: `codexPlanPermissions(): string[]`, exported for test.

- [ ] **Step 1: Write the failing test**

Create `tests/main/codexPlanMode.test.ts`. Copy the `options()`, `argvEchoCli()` and `argv()` helpers verbatim from `tests/main/codexMcp.test.ts:18-52` — that file's `argv()` returns the argv as a string array by echoing each argument back as an `agent_message`.

```ts
import { describe, expect, test } from 'vitest'
import { codexPlanPermissions } from '@main/runners/codex'

describe('the sandbox a planning turn runs under', () => {
  test('grants no writable path at all', () => {
    // Plan mode means research only. For Claude the SDK refuses every edit;
    // for Codex the equivalent is a profile with nothing writable in it.
    const overrides = codexPlanPermissions()

    expect(overrides.some((override) => override.includes('filesystem'))).toBe(false)
  })

  test('keeps network on, because research is the turn that needs it', () => {
    expect(codexPlanPermissions()).toContain('permissions.roster-plan.network.enabled=true')
  })

  test('is what a planning turn actually asks codex for', async () => {
    const args = await argv({ planMode: true })

    expect(args).toContain('default_permissions="roster-plan"')
    expect(args.some((arg) => arg.includes('roster-worktree'))).toBe(false)
  })

  test('a turn that is not planning keeps the writable worktree profile', async () => {
    const args = await argv({})

    expect(args).toContain('default_permissions="roster-worktree"')
    expect(args.some((arg) => arg.includes('roster-plan'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/codexPlanMode.test.ts`
Expected: FAIL — `codexPlanPermissions` is not exported from `@main/runners/codex`.

- [ ] **Step 3: Implement**

In `electron/main/runners/codex.ts`, beside `WORKTREE_PERMISSION_PROFILE` (`codex.ts:135`):

```ts
const PLAN_PERMISSION_PROFILE = 'roster-plan'

/**
 * The sandbox for a planning turn: read everything, write nothing.
 *
 * Plan mode means research and propose only. Claude enforces that inside the
 * SDK, which refuses every edit for the whole turn; Codex enforces through
 * its sandbox, so the equivalent is a profile with no writable path.
 *
 * Network stays on for the same reason the worktree profile turns it on:
 * research is the turn that most needs to reach the internet, and a
 * read-only profile that also cut the network would make plan mode useless
 * rather than safe.
 */
export function codexPlanPermissions(): string[] {
  return [
    `default_permissions=${tomlString(PLAN_PERMISSION_PROFILE)}`,
    `permissions.${PLAN_PERMISSION_PROFILE}.extends=${tomlString(':read-only')}`,
    `permissions.${PLAN_PERMISSION_PROFILE}.network.enabled=true`,
  ]
}
```

In `run()` (`codex.ts:81`), choose the profile:

```ts
    const permissions = [
      ...(options.planMode === true
        ? codexPlanPermissions()
        : codexPermissionOverrides(options.cwd)),
      ...codexMcpOverrides(options.mcpServers),
    ].flatMap((override) => ['--config', override])
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/main/codexPlanMode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/main/runners/codex.ts tests/main/codexPlanMode.test.ts
git commit -m "feat: run codex planning turns under a read-only sandbox"
```

---

### Task 4: Tell the agent how to propose

**Files:**
- Modify: `electron/main/sessions/planPrompt.ts`, `electron/main/runners/codex.ts`
- Test: `tests/main/planPrompt.test.ts`, `tests/main/codexPlanMode.test.ts`

**Interfaces:**
- Produces: `planInstruction(): string`, exported from `electron/main/sessions/planPrompt.ts`.
- Note the import direction: `runners/codex.ts` importing from `sessions/planPrompt.ts` is new. It is acyclic — `planPrompt.ts` imports only `shared/types` and `worktreesDir` — and it is the right trade: every other plan prompt string already lives in that file, and duplicating this one into the runner would be the drift the file exists to prevent.

- [ ] **Step 1: Write the failing tests**

In `tests/main/planPrompt.test.ts`:

```ts
describe('the plan instruction a runner without a native plan mode is given', () => {
  test('names the tool that ends the turn', () => {
    // Approach A invites a proposal where a schema would compel one, so this
    // string is the whole of the mechanism's reliability. A rewrite that
    // quietly drops it leaves an agent that plans and never proposes.
    expect(planInstruction()).toContain('propose_plan')
  })

  test('says the turn cannot write, which is the part the agent cannot discover', () => {
    expect(planInstruction()).toMatch(/read-only|cannot write/i)
  })
})

describe('asking for a revision', () => {
  test('does not name a tool only one runner has', () => {
    // Every revision turn goes through this string, for every runner. A
    // Codex agent told to call ExitPlanMode is told to call something that
    // does not exist for it.
    expect(revisePrompt(input)).not.toContain('ExitPlanMode')
  })
})
```

Build `input` with the `PlanPromptInput` fixture already used in that file.

In `tests/main/codexPlanMode.test.ts`:

```ts
test('a planning turn carries the instruction naming propose_plan', async () => {
  const args = await argv({ planMode: true, systemPrompt: 'Be brief.' })

  expect(args.join('\n')).toContain('propose_plan')
  expect(args.join('\n')).toContain('Be brief.')
})

test('an ordinary turn does not', async () => {
  const args = await argv({ systemPrompt: 'Be brief.' })

  expect(args.join('\n')).not.toContain('propose_plan')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/planPrompt.test.ts tests/main/codexPlanMode.test.ts`
Expected: FAIL — `planInstruction` is not exported; `revisePrompt` still contains `ExitPlanMode`.

- [ ] **Step 3: Implement**

In `electron/main/sessions/planPrompt.ts`, add:

```ts
/**
 * How a runner with no native plan mode is told to present its plan.
 *
 * Claude needs none of this: the SDK's own plan mode instructs the model and
 * supplies ExitPlanMode. Codex has no equivalent, so the mechanism has to be
 * named, and this string is the whole of it.
 */
export function planInstruction(): string {
  return [
    'You are in plan mode: research and propose only.',
    'You cannot write files this turn — the sandbox is read-only and every edit will be refused.',
    '',
    'When the plan is ready, call the propose_plan tool on the "plans" MCP server,',
    'passing the whole plan as Markdown in `plan` and opening with a heading that',
    'names what you propose to do. That ends the turn.',
    '',
    'Do not start the work. You will be told whether to build it.',
  ].join('\n')
}
```

Make `revisePrompt` tool-neutral — change `planPrompt.ts:55` from
`'Stay in plan mode: present the revised plan with ExitPlanMode when it is ready.'` to:

```ts
    'Stay in plan mode: present the revised plan for review when it is ready.',
```

Leave `reviseReason` (`planPrompt.ts:78`) unchanged: it is only ever sent as the reason a live `ExitPlanMode` call is refused, which cannot happen for Codex.

In `electron/main/runners/codex.ts`, import it and compose:

```ts
import { planInstruction } from '../sessions/planPrompt'
```

Replace the final prompt push (`codex.ts:120`):

```ts
    // Plan mode has no Codex equivalent, so the instruction that would come
    // from the SDK has to travel in the system prompt instead.
    const systemPrompt =
      options.planMode === true
        ? [options.systemPrompt.trim(), planInstruction()].filter((part) => part !== '').join('\n\n')
        : options.systemPrompt

    args.push(composePrompt(prompt, systemPrompt))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/planPrompt.test.ts tests/main/codexPlanMode.test.ts tests/main/planFlow.test.ts`
Expected: PASS. `planFlow.test.ts` is included because it asserts on revision prompts.

- [ ] **Step 5: Commit**

```bash
git add electron/main/sessions/planPrompt.ts electron/main/runners/codex.ts tests/main/planPrompt.test.ts tests/main/codexPlanMode.test.ts
git commit -m "feat: tell a codex agent how to present its plan"
```

---

### Task 5: Prove it end to end, and prove the sandbox actually bites

**Files:**
- Test: `tests/main/planRunnerReach.test.ts`, `tests/main/codexPlanMode.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-4. Adds no production code.

This task exists because Tasks 1-4 each prove Roster *asks* for the right thing. Neither proves a plan actually arrives over the socket, nor that Codex refuses a write.

- [ ] **Step 1: Write the end-to-end bridge test**

In `tests/main/planRunnerReach.test.ts`, add a fixture that starts a real bridge over its unix socket and returns a way to call it. PR #67 built this shape for `record_pull_request`; if that PR has not merged, write it:

```ts
/** A real McpBridge over its socket, holding this session's built-in tools. */
async function codexBridgeFor(
  agentOverrides: Partial<Agent>,
  sendOptions: SendOptions = {},
): Promise<{ bridge: BridgeHandle; plans: PlanStore; session: Session }> {
  const { manager, session, plans, agent } = await codexSessionFor(agentOverrides)
  const toolSet = builtinToolSetFrom(manager, agent, session, sendOptions.planMode === true)
  const bridge = await McpBridge.start(builtinToolDefinitions(toolSet, agent.id))

  // `call` speaks the same line protocol mcpStdio.ts uses: connect to
  // bridge.launchSpec().env.ROSTER_MCP_SOCKET, send the token, then one
  // JSON request per line.
  return { bridge: connectTo(bridge), plans, session }
}
```

Then assert against the real store:

```ts
test('a propose_plan call over the real socket lands a plan in the store', async () => {
  // Arrange
  const { bridge, plans, session } = await codexBridgeFor({ mcpServers: [] }, { planMode: true })

  // Act
  const result = await bridge.call('propose_plan', { plan: '# Cache the board\n\nWhy and how.' })

  // Assert
  expect(result.isError).toBeFalsy()
  expect(plans.listBySession(session.id).map((plan) => plan.title)).toEqual(['Cache the board'])
})

test('a codex plan is indistinguishable from a claude one', async () => {
  // The visualisation reads no runner field, so this is what makes it work
  // for Codex without a single renderer change.
  const { bridge, plans, session } = await codexBridgeFor({ mcpServers: [] }, { planMode: true })
  await bridge.call('propose_plan', { plan: '# A plan\n\nBody.' })

  const [plan] = plans.listBySession(session.id)

  expect(plan).toMatchObject({ status: 'draft', version: 1, title: 'A plan' })
  expect(plan.prUrl).toBeUndefined()
})
```

- [ ] **Step 2: Run it to verify it fails, then passes**

Run: `npx vitest run tests/main/planRunnerReach.test.ts`
Expected: FAIL first if the bridge harness is not yet present; PASS once Tasks 1-2 are in and the harness is wired. No production change should be needed — if one is, stop: it means Task 1 or 2 is incomplete.

- [ ] **Step 3: Write the sandbox enforcement test**

This is the risk flagged in §7 of the spec: the profile is known to *parse*, not to be *honoured*. This test needs the real `codex` binary, so guard it the way the suite guards other binary-dependent tests and skip when absent.

```ts
test.skipIf(!codexBinary())('the read-only profile refuses a write', async () => {
  // Arrange: a real codex exec under the planning profile, asked to write.
  const dir = await mkdtemp(join(tmpdir(), 'roster-planbox-'))

  // Act
  const result = await runCodex(codexPlanPermissions(), dir, 'Create a file called out.txt')

  // Assert
  expect(existsSync(join(dir, 'out.txt'))).toBe(false)
})
```

- [ ] **Step 4: Run it and read the result carefully**

Run: `npx vitest run tests/main/codexPlanMode.test.ts`

**If this fails because `:read-only` is not a valid profile base, stop and report.** The spec's §7 fallback is `--sandbox read-only`, which costs network access inside planning turns — a trade-off that goes back to the user rather than being taken silently.

- [ ] **Step 5: Cover the lifecycle the spec asks for**

Spec §6.6. `PlanFlow` is unchanged by this plan, so these tests guard that the
unchanged code does the right thing for a runner it was never exercised with.
In `tests/main/planFlow.test.ts`, using the existing fixtures:

```ts
test('a revision turn for a codex agent is queued in plan mode', () => {
  // Arrange: no pending ExitPlanMode, which is always true for Codex.
  const { flow, manager, plan } = flowWithPlan({ pendingApprovals: [] })

  // Act
  flow.submit(plan.id, 'Say more about the migration.')

  // Assert
  expect(manager.enqueued).toEqual([
    expect.objectContaining({ options: { planMode: true } }),
  ])
})

test('the build turn is not in plan mode, so it can write', () => {
  const { flow, manager, plan } = flowWithPlan({ pendingApprovals: [] })

  flow.approve(plan.id)

  expect(manager.enqueued.at(-1)?.options.planMode).toBeUndefined()
})
```

Run: `npx vitest run tests/main/planFlow.test.ts`
Expected: PASS without touching `planFlow.ts`. If either fails, stop — the spec's
claim that `PlanFlow` needs no changes is wrong and the design needs revisiting.

- [ ] **Step 6: Run the whole gate and commit**

```bash
npm run check
git add tests/main/planRunnerReach.test.ts tests/main/codexPlanMode.test.ts
git commit -m "test: prove a codex agent can propose a plan end to end"
```

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/codex-plan-mode
gh pr create --fill
```

Do not merge it.

---

## Manual verification

Automated tests cannot show that a real model chooses to call the tool — the
one thing Approach A trades away. After the suite is green:

1. `ROSTER_HOME=/tmp/roster-codex-plan npm run dev`
2. Create a Codex agent pointed at a git checkout. Do **not** enable the plans MCP server on it.
3. Toggle plan mode on in the composer and ask for something that needs research.
4. Expect: the agent researches, calls `propose_plan`, and the plan appears for review. No file in the checkout changed.
5. Send a note back. Expect a second read-only turn and a revised plan.
6. Approve. Expect a build turn that *can* write, on the plan's branch, ending in a recorded pull request.

Step 4 is the one that can fail on a real model where the tests pass. If it
does, the fix is `planInstruction()`, not the mechanism.
