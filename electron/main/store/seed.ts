import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { TASKS_SERVER } from '../../../shared/mcp'
import { serializeAgentToml, type AgentConfig } from './agentToml'
import { agentDir, agentTomlPath, agentsDir, rosterHome, skillsDir } from './paths'

/**
 * First-run content. Mirrors the roster in the design handoff so a fresh
 * install has something to look at; every file is a real, editable
 * agent.toml, not a hardcoded demo array.
 *
 * Working directories point at `~/roster/workspace` rather than the handoff's
 * `~/work/api`, which does not exist on a new machine. Deliberately not the
 * user's home: an approved write would otherwise land directly in it.
 *
 * All four start with the built-in task board enabled, so a fresh install has
 * a board agents can actually work. Turning it off per agent is what the MCP
 * screen is for.
 */
function seedAgents(workspace: string): AgentConfig[] {
  return [
    {
      id: 'architect',
      name: 'Architect Agent',
      runner: 'claude',
      model: 'claude-opus-5',
      cwd: workspace,
      systemPrompt:
        'You design before you build. Compare at least two shapes, state the trade-off in one sentence each, and record the decision as an ADR in docs/adr. Hand implementation work to other agents rather than editing source yourself.',
      skills: ['adr-writer', 'estimate-breakdown'],
      mcpServers: ['filesystem', 'github', TASKS_SERVER],
      hidden: false,
    },
    {
      id: 'debugging',
      name: 'Debugging Agent',
      runner: 'claude',
      model: 'claude-opus-5',
      cwd: workspace,
      systemPrompt:
        'Reproduce before you fix. Write the failing test first, commit it alone, then patch. Never force-push without asking. Keep changes scoped to the files named in the request.',
      skills: ['repro-harness', 'stack-triage'],
      mcpServers: ['filesystem', TASKS_SERVER],
      hidden: false,
    },
    {
      id: 'review',
      name: 'Review Agent',
      runner: 'claude',
      model: 'claude-sonnet-5',
      cwd: workspace,
      systemPrompt:
        'Review for correctness first, style last. Separate blocking notes from nits and quote the line you are reacting to. If the change lacks a test, say so before anything else.',
      skills: ['pr-review', 'stack-triage'],
      mcpServers: ['filesystem', 'github', TASKS_SERVER],
      hidden: false,
    },
    {
      id: 'estimation',
      name: 'Estimation Agent',
      runner: 'claude',
      model: 'claude-haiku-4-5',
      cwd: workspace,
      systemPrompt:
        'Break work down until every task is a day or less. Flag unowned tasks and cross-team dependencies explicitly. Give ranges, not single numbers.',
      skills: ['estimate-breakdown'],
      mcpServers: [TASKS_SERVER],
      hidden: false,
    },
  ]
}

const SEED_SKILLS: Record<string, string> = {
  'repro-harness': `# Repro Harness

Turn a bug report into a minimal failing test before touching source.

## When to use

- A stack trace or failing CI job is in the request
- The user says "it breaks when…" without a test

## Steps

1. Read the trace top-down; find the first frame inside the repo.
2. Write the smallest test that fails for the same reason.
3. Commit the test alone, then fix.
`,
  'stack-triage': `# Stack Triage

Read a stack trace and name the first frame worth reading.

## Steps

1. Skip framework frames until the first one inside the repo.
2. Read that function in full before forming a hypothesis.
3. State the hypothesis before changing anything.
`,
  'adr-writer': `# ADR Writer

Record an architectural decision as a numbered ADR.

## Format

- Context — what forced the decision
- Options — at least two, each with its trade-off in one sentence
- Decision — the choice and why
- Consequences — what becomes harder
`,
  'pr-review': `# PR Review

Review a change for correctness first, style last.

## Rules

- Separate blocking notes from nits explicitly.
- Quote the line you are reacting to.
- If the change lacks a test, say so before anything else.
`,
  'estimate-breakdown': `# Estimate Breakdown

Break work down until every task is a day or less.

## Rules

- Give ranges, never single numbers.
- Flag unowned tasks and cross-team dependencies.
`,
}

const SEED_MCP = {
  servers: [
    { name: 'filesystem', command: 'npx @modelcontextprotocol/server-filesystem ~', env: {} },
    { name: 'github', command: 'npx @modelcontextprotocol/server-github', env: {} },
  ],
}

/** Seeds only when the agents directory is empty; never overwrites user files. */
export async function seedIfEmpty(mcpPath: string): Promise<boolean> {
  await mkdir(agentsDir(), { recursive: true })
  const existing = await readdir(agentsDir())
  if (existing.length > 0) return false

  const workspace = join(rosterHome(), 'workspace')
  await mkdir(workspace, { recursive: true })

  for (const config of seedAgents(workspace)) {
    await mkdir(agentDir(config.id), { recursive: true })
    await writeFile(agentTomlPath(config.id), serializeAgentToml(config), 'utf8')
  }

  for (const [name, body] of Object.entries(SEED_SKILLS)) {
    await mkdir(join(skillsDir(), name), { recursive: true })
    await writeFile(join(skillsDir(), name, 'SKILL.md'), body, 'utf8')
  }

  await writeFile(mcpPath, `${JSON.stringify(SEED_MCP, null, 2)}\n`, 'utf8')
  return true
}
