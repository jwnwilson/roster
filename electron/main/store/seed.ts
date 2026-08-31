import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { agentsDir, rosterHome, skillsDir } from './paths'

/**
 * First-run content. A fresh install starts with no agents and no tasks —
 * users build their own roster. Skills and MCP servers still seed as
 * starter content: they are generically useful templates, not demo data
 * tied to a canned agent roster.
 */

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

  await mkdir(join(rosterHome(), 'workspace'), { recursive: true })

  for (const [name, body] of Object.entries(SEED_SKILLS)) {
    await mkdir(join(skillsDir(), name), { recursive: true })
    await writeFile(join(skillsDir(), name, 'SKILL.md'), body, 'utf8')
  }

  await writeFile(mcpPath, `${JSON.stringify(SEED_MCP, null, 2)}\n`, 'utf8')
  return true
}
