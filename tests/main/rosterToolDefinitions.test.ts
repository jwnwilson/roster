import { describe, expect, test, vi } from 'vitest'
import { MEMORY_SERVER, PLANS_SERVER, ROSTER_SERVER, TASKS_SERVER } from '@shared/mcp'
import { ROSTER_TOOL_NAMES } from '@main/runners/handoffTool'
import { TASK_TOOL_NAMES } from '@main/runners/taskTools'
import { PLAN_TOOL_NAMES } from '@main/runners/planTools'
import { MEMORY_TOOL_NAMES } from '@main/runners/memoryTools'
import {
  builtinToolDefinitions,
  toWireTools,
  type BuiltinToolSet,
} from '@main/runners/toolDefinitions'
import type { Agent } from '@shared/types'

const AGENT: Agent = {
  id: 'me',
  name: 'Me',
  runner: 'codex',
  model: 'gpt-5.5',
  cwd: '/work',
  cwdLabel: '~/work',
  systemPrompt: '',
  skills: [],
  mcpServers: [],
  hidden: false,
  status: 'idle',
}

function fullSet(): BuiltinToolSet {
  return {
    roster: {
      listAgents: () => [AGENT],
      openSession: () => ({ sessionId: 's', label: 'l', started: true }),
    },
    tasks: {
      list: () => [],
      find: () => null,
      comments: () => [],
      projectName: () => null,
      isArchivedProject: () => false,
      agentName: () => null,
      create: () => ({}) as never,
      update: () => ({}) as never,
      comment: () => {},
    },
    plans: { recordPullRequest: () => ({}) as never },
    memory: { recall: () => '', remember: async () => undefined },
  }
}

/** The bare tool name out of the name Claude's SDK namespaces it under. */
function bare(namespaced: string): string {
  return namespaced.replace(/^mcp__[^_]+__/, '')
}

describe('the built-in tool definitions', () => {
  test('carry exactly the tools the Claude allowlist names, so the two cannot drift', () => {
    const defined = builtinToolDefinitions(fullSet(), AGENT.id).map((tool) => tool.name)

    expect(new Set(defined)).toEqual(
      new Set(
        [
          ...ROSTER_TOOL_NAMES,
          ...TASK_TOOL_NAMES,
          ...PLAN_TOOL_NAMES,
          ...MEMORY_TOOL_NAMES,
        ].map(bare),
      ),
    )
  })

  test('name a server for every tool, matching the one Claude registers it under', () => {
    const byName = new Map(
      builtinToolDefinitions(fullSet(), AGENT.id).map((tool) => [tool.name, tool.server]),
    )

    expect(byName.get('list_agents')).toBe(ROSTER_SERVER)
    expect(byName.get('list_tasks')).toBe(TASKS_SERVER)
    expect(byName.get('record_pull_request')).toBe(PLANS_SERVER)
    expect(byName.get('recall')).toBe(MEMORY_SERVER)
  })

  test('leave out the sets the agent was not given', () => {
    const names = builtinToolDefinitions({ roster: fullSet().roster }, AGENT.id).map((t) => t.name)

    expect(names).toEqual([...ROSTER_TOOL_NAMES].map(bare))
  })

  test('have unique names, since they share one namespace on the wire', () => {
    const names = builtinToolDefinitions(fullSet(), AGENT.id).map((tool) => tool.name)

    expect(new Set(names).size).toBe(names.length)
  })
})

describe('the wire form a separate CLI receives', () => {
  test('turns each zod shape into JSON Schema', () => {
    const wire = toWireTools(builtinToolDefinitions(fullSet(), AGENT.id))
    const readTask = wire.find((tool) => tool.name === 'read_task')

    expect(readTask?.inputSchema).toMatchObject({
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    })
  })

  test('gives a no-argument tool an empty object schema rather than nothing', () => {
    const wire = toWireTools(builtinToolDefinitions(fullSet(), AGENT.id))

    expect(wire.find((tool) => tool.name === 'recall')?.inputSchema).toMatchObject({
      type: 'object',
      properties: {},
    })
  })

  test('annotates every tool as neither destructive nor open-world', () => {
    // Codex refuses an unannotated MCP tool in a non-interactive run — it
    // treats the MCP default (destructive) as needing an approval nobody is
    // there to give. This is the whole reason a Codex agent can call these.
    const wire = toWireTools(builtinToolDefinitions(fullSet(), AGENT.id))

    expect(wire).not.toHaveLength(0)
    for (const tool of wire) {
      expect(tool.annotations.destructiveHint).toBe(false)
      expect(tool.annotations.openWorldHint).toBe(false)
    }
  })

  test('marks the tools that only read as read-only', () => {
    const wire = toWireTools(builtinToolDefinitions(fullSet(), AGENT.id))
    const readOnly = wire.filter((tool) => tool.annotations.readOnlyHint === true)

    expect(readOnly.map((tool) => tool.name).sort()).toEqual([
      'list_agents',
      'list_tasks',
      'read_task',
      'recall',
    ])
  })

  test('carries the description the agent reads, not an empty string', () => {
    for (const tool of toWireTools(builtinToolDefinitions(fullSet(), AGENT.id))) {
      expect(tool.description.length).toBeGreaterThan(10)
    }
  })
})

describe('the handlers behind those definitions', () => {
  test('are the same ones the Claude path builds', async () => {
    const openSession = vi.fn(() => ({ sessionId: 's1', label: 'Review · Fix', started: true }))
    const defined = builtinToolDefinitions(
      { roster: { listAgents: () => [AGENT], openSession } },
      'other',
    )

    const tool = defined.find((entry) => entry.name === 'open_session')
    const result = await tool?.handler(
      { agent_id: 'me', title: 'Fix', brief: 'the brief' } as never,
      undefined,
    )

    expect(openSession).toHaveBeenCalledWith({
      toAgentId: 'me',
      title: 'Fix',
      brief: 'the brief',
    })
    expect(JSON.stringify(result)).toContain('Review · Fix')
  })
})

describe('handing work to another agent', () => {
  function rosterOnly(
    overrides: Partial<{
      agents: Agent[]
      openSession: BuiltinToolSet['roster']['openSession']
    }> = {},
  ) {
    return builtinToolDefinitions(
      {
        roster: {
          listAgents: () => overrides.agents ?? [AGENT],
          openSession:
            overrides.openSession ??
            (() => ({ sessionId: 's', label: 'Me · Fix', started: true })),
        },
      },
      'me',
    )
  }

  async function call(name: string, args: Record<string, unknown>, set = rosterOnly()) {
    const tool = set.find((entry) => entry.name === name)
    if (!tool) throw new Error(`no tool called ${name}`)
    return JSON.stringify(await tool.handler(args as never, undefined))
  }

  test('refuses an agent id that is not on the roster', async () => {
    const result = await call('open_session', { agent_id: 'ghost', title: 'T', brief: 'B' })

    expect(result).toContain('No agent with id')
    expect(result).toContain('ghost')
    expect(result).toContain('isError')
  })

  test('says plainly when the session was opened but nothing started it', async () => {
    const set = rosterOnly({
      openSession: () => ({ sessionId: 's', label: 'Me · Fix', started: false }),
    })

    const result = await call('open_session', { agent_id: 'me', title: 'Fix', brief: 'B' }, set)

    expect(result).toContain('waiting for a person to send it')
  })

  test('says so when there is nobody else to hand work to', async () => {
    // The only agent on the roster is the one asking.
    const set = builtinToolDefinitions(
      {
        roster: {
          listAgents: () => [AGENT],
          openSession: () => ({ sessionId: 's', label: 'l', started: true }),
        },
      },
      AGENT.id,
    )

    expect(await call('list_agents', {}, set)).toContain('No other agents are available')
  })

  test('describes an agent that has no system prompt without pretending it has one', async () => {
    const set = rosterOnly({ agents: [{ ...AGENT, id: 'them', systemPrompt: '' }] })

    expect(await call('list_agents', {}, set)).toContain('no system prompt')
  })

  test('leaves out an agent that is in error, which cannot pick work up', async () => {
    const set = rosterOnly({
      agents: [{ ...AGENT, id: 'broken', name: 'Broken', status: 'error' }],
    })

    expect(await call('list_agents', {}, set)).toContain('No other agents are available')
  })
})
