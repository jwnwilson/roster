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
| `tests/main/codexSessionTools.test.ts` | Per-runner reach over the real bridge | Extend — it already holds the bridge/socket harness |
| `tests/main/planFlow.test.ts` | The plan lifecycle | Extend |

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
- Test: `tests/main/codexSessionTools.test.ts` (extend — it already holds the bridge harness)

**Interfaces:**
- Consumes: `PlanTools.propose` from Task 1; `PlanStore.listBySession(sessionId): Plan[]` (`electron/main/store/plans.ts:90`).
- Produces: `planToolsFor(agent: Agent, session: Session, planMode: boolean): PlanTools | undefined`.

- [ ] **Step 1: Write the failing tests**

`builtinToolsFor` is private, so drive this through the public `send` and assert on the tools the bridge actually served. **`tests/main/codexSessionTools.test.ts` already has that harness** — a stubbed runner with `Object.setPrototypeOf(runnerStub, CodexRunner.prototype)` so the `instanceof` branch at `manager.ts:395` is genuinely taken, a real `McpBridge`, and a `served` array filled by `listOverBridge` from inside the turn. Extend that file; do not create a new one.

Two fixture changes it needs first. Give `run()` an options parameter:

```ts
async function run(agentId = 'codey', options: SendOptions = {}): Promise<void> {
  const session = manager.create(agentId, 'Work')
  await manager.send(session.id, 'go', options)
}
```

and hoist the plan store so a test can seed it — it is currently constructed inline in the `SessionManager` argument list:

```ts
let plans: InstanceType<typeof PlanStore>
// ...in beforeEach, replacing `new PlanStore(db)` in the constructor call:
plans = new PlanStore(db)
```

Then add, following the shape of the existing test at `:177` ("is decided by its own mcp_servers"):

```ts
describe('a Codex agent in plan mode', () => {
  test('is given propose_plan even when it has not enabled the plans server', async () => {
    // Arrange
    agents = [agent({ mcpServers: [] })]

    // Act
    await run('codey', { planMode: true })

    // Assert
    expect(served.map((tool) => tool.name)).toContain('propose_plan')
  })

  test('gets neither plan tool on an ordinary turn with no plans server', async () => {
    agents = [agent({ mcpServers: [] })]

    await run('codey')

    expect(served.map((tool) => tool.name)).not.toContain('propose_plan')
    expect(served.map((tool) => tool.name)).not.toContain('record_pull_request')
  })

  test('keeps the plan tools on the build turn once the session has a plan', async () => {
    // The build turn is not a plan-mode turn. Without this the agent could
    // never report its pull request, and settleBuild would cycle the plan
    // back to draft — the exact trap this work closes.
    agents = [agent({ mcpServers: [] })]
    const session = manager.create('codey', 'Work')
    plans.capture({ sessionId: session.id, agentId: 'codey', body: '# Done\n' })

    await manager.send(session.id, 'build it')

    expect(served.map((tool) => tool.name)).toContain('record_pull_request')
  })
})
```

Import `SendOptions` as a type from `@main/sessions/manager`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/codexSessionTools.test.ts`
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

Run: `npx vitest run tests/main/codexSessionTools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/main/sessions/manager.ts tests/main/codexSessionTools.test.ts
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

### Task 5: Prove it end to end

**Files:**
- Test: `tests/main/codexSessionTools.test.ts`, `tests/main/planFlow.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-4. Adds no production code. If any step here needs a production change, stop — it means an earlier task is incomplete.

Tasks 1-4 each prove Roster *asks* for the right thing. This one proves a plan actually arrives over the socket, and that the lifecycle carries it.

- [ ] **Step 1: Write the end-to-end bridge test**

`tests/main/codexSessionTools.test.ts` has `listOverBridge`, which speaks the bridge's line protocol for the `list` op. Add its sibling for `call` — the bridge handles both at `electron/main/runners/mcpBridge.ts:150-151`:

```ts
/** Calls one tool over the bridge, as the stdio child would. */
function callOverBridge(
  spec: McpLaunchSpec,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError?: boolean; content: { text: string }[] }> {
  return new Promise((resolve, reject) => {
    const socket = connect(spec.env['ROSTER_MCP_SOCKET'] ?? '')
    let buffer = ''
    socket.on('error', reject)
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      if (!buffer.includes('\n')) return
      socket.destroy()
      resolve(JSON.parse(buffer.slice(0, buffer.indexOf('\n'))).result)
    })
    socket.on('connect', () =>
      socket.write(
        `${JSON.stringify({
          id: 1,
          op: 'call',
          name,
          args,
          token: spec.env['ROSTER_MCP_TOKEN'],
        })}\n`,
      ),
    )
  })
}
```

Check the exact response envelope against `mcpBridge.ts` before asserting on it — the `list` helper reads `.tools`, so `call` may or may not wrap its payload in `.result`. Match what the bridge actually writes.

The runner stub reads the tool list from inside the turn; do the same for the call, since the bridge only exists while a turn is running. Add a second stub implementation for these tests, following the existing `runnerStub.run.mockImplementation` shape, that calls `propose_plan` instead of only listing:

```ts
describe('a Codex agent presenting a plan', () => {
  test('a propose_plan call over the real socket lands a plan in the store', async () => {
    // Arrange
    agents = [agent({ mcpServers: [] })]
    let result: { isError?: boolean; content: { text: string }[] } | null = null
    runnerStub.run.mockImplementation((_prompt: string, options: StartOptions) => {
      return (async function* () {
        const spec = options.mcpServers[ROSTER_SERVER]
        if (spec) {
          result = await callOverBridge(spec, 'propose_plan', {
            plan: '# Cache the board\n\nWhy and how.',
          })
        }
        yield { kind: 'done' as const, runnerSessionId: 'thread-1' }
      })()
    })
    const session = manager.create('codey', 'Work')

    // Act
    await manager.send(session.id, 'research it', { planMode: true })

    // Assert
    expect(result?.isError).toBeFalsy()
    expect(plans.listBySession(session.id).map((plan) => plan.title)).toEqual(['Cache the board'])
  })

  test('produces a plan indistinguishable from a Claude one', async () => {
    // The visualisation reads no runner field, which is what makes this
    // work for Codex without a single renderer change.
    agents = [agent({ mcpServers: [] })]
    runnerStub.run.mockImplementation((_prompt: string, options: StartOptions) => {
      return (async function* () {
        const spec = options.mcpServers[ROSTER_SERVER]
        if (spec) await callOverBridge(spec, 'propose_plan', { plan: '# A plan\n\nBody.' })
        yield { kind: 'done' as const, runnerSessionId: 'thread-1' }
      })()
    })
    const session = manager.create('codey', 'Work')

    await manager.send(session.id, 'research it', { planMode: true })

    const [plan] = plans.listBySession(session.id)
    expect(plan).toMatchObject({ status: 'draft', version: 1, title: 'A plan' })
    expect(plan?.prUrl).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/main/codexSessionTools.test.ts`
Expected: PASS, with no production change. If a production change is needed, stop and report — Task 1 or 2 is incomplete.

- [ ] **Step 3: Cover the lifecycle**

`PlanFlow` is unchanged by this plan, so these guard that the unchanged code does the right thing for a runner it was never exercised with. Add to `tests/main/planFlow.test.ts`, using its existing module-level fixtures — `flow`, `plans`, `pending`, `planAwaitingReview()`, and `const manager = { pendingApprovals: vi.fn(() => pending), respondToApproval: vi.fn(), enqueue: vi.fn() }`:

```ts
describe('a plan from a runner that never blocks', () => {
  test('queues the revision turn in plan mode', () => {
    // Arrange: no pending ExitPlanMode, which is always the case for Codex.
    const plan = planAwaitingReview()
    pending = []

    // Act
    flow.submit(plan.id, 'Say more about the migration.')

    // Assert
    expect(manager.enqueue).toHaveBeenCalledWith(
      's1',
      expect.any(String),
      { planMode: true },
    )
  })

  test('queues the build turn without plan mode, so it can write', () => {
    const plan = planAwaitingReview()
    pending = []

    flow.approve(plan.id)

    const [, , options] = manager.enqueue.mock.calls.at(-1) ?? []
    expect(options).toBeUndefined()
  })
})
```

Run: `npx vitest run tests/main/planFlow.test.ts`
Expected: PASS without touching `planFlow.ts`. If either fails, stop and report — the spec's claim that `PlanFlow` needs no changes would be wrong, and that is a design question, not a test to bend.

- [ ] **Step 4: Run the whole gate and commit**

```bash
npm run check
git add tests/main/codexSessionTools.test.ts tests/main/planFlow.test.ts
git commit -m "test: prove a codex agent can propose a plan end to end"
```

`npm run check` must pass: typecheck, coverage (80% statements/lines/functions, 70% branches) and build.

**Note on the sandbox enforcement test.** An earlier draft of this plan called for a test that runs the real `codex` binary under the planning profile and asserts a write is refused. It is deliberately NOT in the suite: it needs the real binary, a live API call and an authenticated account, and the suite has no skip-when-absent precedent — a test that silently skips in CI proves nothing while looking like it does. It is a manual check instead, below, and the spec's §7 risk stays open until someone runs it.

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

**7. Prove the sandbox actually refuses a write.** This is the spec's §7 risk and
the only check that closes it. With a real `codex` binary:

```bash
codex exec --json --skip-git-repo-check --ignore-user-config --strict-config \
  --config 'default_permissions="roster-plan"' \
  --config 'permissions.roster-plan.extends=":read-only"' \
  --config 'permissions.roster-plan.network.enabled=true' \
  -C /tmp/roster-planbox --model <a model your account has> \
  'Create a file called out.txt in the current directory'
```

Expect: no `out.txt`, and the refusal visible in the JSON stream. **If `:read-only`
is rejected as a profile base, stop and report** — the fallback is
`--sandbox read-only`, which costs network access inside planning turns, and that
trade-off is the user's to make, not the implementer's.
