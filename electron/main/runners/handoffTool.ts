import { z } from 'zod'
import type { Agent } from '../../../shared/types'

/**
 * The roster tools an agent can call.
 *
 * This is what makes handoff real rather than decorative: an agent asks
 * Roster to open a session on another agent, and Roster records the spawn so
 * both sides show the link.
 */
export interface RosterTools {
  listAgents(): Agent[]
  /** Returns the label to show on the handoff pill. */
  openSession(input: { toAgentId: string; title: string; brief: string }): {
    sessionId: string
    label: string
  }
}

export const OPEN_SESSION_SCHEMA = {
  agent_id: z.string().describe('The id of the agent to hand work to.'),
  title: z.string().describe('A short title for the session, shown on its tab.'),
  brief: z.string().describe('What that agent should do. It sees this as its first message.'),
}

/**
 * Builds an in-process MCP server exposing the roster tools.
 *
 * Created lazily with the SDK's own factory so the module graph does not pull
 * in the SDK runtime for callers that only normalise events.
 */
export async function createRosterMcpServer(
  tools: RosterTools,
  currentAgentId: string,
): Promise<unknown> {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')

  const listAgents = tool(
    'list_agents',
    'List the other agents on this roster, so you can choose one to hand work to.',
    {},
    async () => {
      const others = tools
        .listAgents()
        .filter((agent) => agent.id !== currentAgentId && agent.status !== 'error')
        .map((agent) => `${agent.id} — ${agent.name}: ${firstLine(agent.systemPrompt)}`)

      return {
        content: [
          {
            type: 'text' as const,
            text: others.length === 0 ? 'No other agents are available.' : others.join('\n'),
          },
        ],
      }
    },
  )

  const openSession = tool(
    'open_session',
    'Hand work to another agent by opening a session on it. Use list_agents first.',
    OPEN_SESSION_SCHEMA,
    async (args: { agent_id: string; title: string; brief: string }) => {
      const known = tools.listAgents().some((agent) => agent.id === args.agent_id)
      if (!known) {
        return {
          content: [{ type: 'text' as const, text: `No agent with id "${args.agent_id}".` }],
          isError: true,
        }
      }

      const { label } = tools.openSession({
        toAgentId: args.agent_id,
        title: args.title,
        brief: args.brief,
      })

      return {
        content: [{ type: 'text' as const, text: `Opened "${label}". It will pick the work up.` }],
      }
    },
  )

  return createSdkMcpServer({ name: 'roster', version: '1.0.0', tools: [listAgents, openSession] })
}

function firstLine(prompt: string): string {
  const line = prompt.split('\n')[0]?.trim() ?? ''
  return line === '' ? 'no system prompt' : line
}
