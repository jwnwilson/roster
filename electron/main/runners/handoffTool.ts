import { z } from 'zod'
import type { Agent, Question } from '../../../shared/types'
import { ROSTER_SERVER } from '../../../shared/mcp'

/**
 * The roster tools an agent can call.
 *
 * This is what makes handoff real rather than decorative: an agent asks
 * Roster to open a session on another agent, and Roster records the spawn so
 * both sides show the link.
 */
export interface RosterTools {
  listAgents(): Agent[]
  /**
   * Returns the label to show on the handoff pill, and whether the receiving
   * agent's turn was actually started — see SessionManager.MAX_HANDOFF_DEPTH.
   */
  openSession(input: { toAgentId: string; title: string; brief: string }): {
    sessionId: string
    label: string
    started: boolean
  }
  /** Permanently closes a direct child of this bound session. */
  closeSession(sessionId: string): Promise<boolean>
  /**
   * Pauses the turn until the person answers in Roster. The answers are keyed
   * by the question text, matching the shape Roster already stores.
   */
  requestUserDecision(questions: Question[]): Promise<{ approved: boolean; answers: Record<string, string> }>
}

/**
 * Every tool this server registers, as the SDK namespaces them.
 *
 * Exported so the runner's allowlist cannot drift from what is actually
 * registered — these are affordances of the app rather than actions on the
 * user's machine, so they are auto-approved, and a tool missing from here
 * silently blocks on the approval gate instead.
 */
export const ROSTER_TOOL_NAMES = [
  'mcp__roster__list_agents',
  'mcp__roster__open_session',
  'mcp__roster__close_session',
  'mcp__roster__request_user_decision',
] as const

export const OPEN_SESSION_SCHEMA = {
  agent_id: z.string().describe('The id of the agent to hand work to.'),
  title: z.string().describe('A short title for the session, shown on its tab.'),
  brief: z.string().describe('What that agent should do. It sees this as its first message.'),
}

export const CLOSE_SESSION_SCHEMA = {
  session_id: z.string().describe('The id of the direct child session to permanently close.'),
}

export const REQUEST_USER_DECISION_SCHEMA = {
  questions: z
    .array(
      z.object({
        question: z.string().min(1).describe('The decision the user needs to make.'),
        header: z.string().min(1).max(12).describe('A short label displayed above the question.'),
        multi_select: z.boolean().describe('Whether the user may choose more than one option.'),
        options: z
          .array(
            z.object({
              label: z.string().min(1).max(40).describe('The option shown to the user.'),
              description: z.string().min(1).describe('What choosing this option means.'),
            }),
          )
          .min(2)
          .max(3)
          .describe('Two or three choices for the user.'),
      }),
    )
    .min(1)
    .max(3)
    .describe('The questions to show in Roster.'),
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

  return createSdkMcpServer({
    name: ROSTER_SERVER,
    version: '1.0.0',
    tools: buildRosterTools(tools, currentAgentId, tool),
  })
}

type ToolFactory = typeof import('@anthropic-ai/claude-agent-sdk').tool

/**
 * The tool definitions themselves, given a factory to build them with.
 *
 * Exported for the same reason its siblings are: the handlers can be
 * exercised without standing up the SDK, and — since a Codex agent gets these
 * same tools through a stdio server rather than an in-process one — there is
 * one definition of each tool rather than one per runner.
 */
export function buildRosterTools(
  tools: RosterTools,
  currentAgentId: string,
  tool: ToolFactory,
) {
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

      const { label, started } = tools.openSession({
        toAgentId: args.agent_id,
        title: args.title,
        brief: args.brief,
      })

      // Said plainly either way: the agent decides what to do next based on
      // this sentence, and "it will pick the work up" when nothing did is
      // how a handoff turns into work quietly going missing.
      return {
        content: [
          {
            type: 'text' as const,
            text: started
              ? `Opened "${label}" and it is working on the brief now.`
              : `Opened "${label}", but too many handoffs deep to start it automatically. ` +
                'It is on the roster with the brief, waiting for a person to send it.',
          },
        ],
      }
    },
  )

  const closeSession = tool(
    'close_session',
    'Permanently close one direct child session that you opened. This cannot be undone.',
    CLOSE_SESSION_SCHEMA,
    async (args: { session_id: string }) => {
      if (!(await tools.closeSession(args.session_id))) {
        return {
          content: [{ type: 'text' as const, text: 'That session is not a direct child of this session.' }],
          isError: true,
        }
      }
      return { content: [{ type: 'text' as const, text: 'Closed the child session permanently.' }] }
    },
  )

  const requestUserDecision = tool(
    'request_user_decision',
    'Ask the user to make a decision in Roster. Use this when work cannot continue without their choice.',
    REQUEST_USER_DECISION_SCHEMA,
    async (args: {
      questions: Array<{
        question: string
        header: string
        multi_select: boolean
        options: Array<{ label: string; description: string }>
      }>
    }) => {
      const decision = await tools.requestUserDecision(
        args.questions.map((question) => ({
          question: question.question,
          header: question.header,
          multiSelect: question.multi_select,
          options: question.options,
        })),
      )

      if (!decision.approved) {
        return {
          content: [{ type: 'text' as const, text: 'The user declined to make that decision.' }],
          isError: true,
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ answers: decision.answers }) }],
      }
    },
  )

  return [listAgents, openSession, closeSession, requestUserDecision]
}

function firstLine(prompt: string): string {
  const line = prompt.split('\n')[0]?.trim() ?? ''
  return line === '' ? 'no system prompt' : line
}
