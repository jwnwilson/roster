import { z } from 'zod'
import type { Plan, PlanStatus } from '../../../shared/types'
import { PLANS_SERVER } from '../../../shared/mcp'

/**
 * Plans, as an agent sees them.
 *
 * Deliberately narrow, and write-only in both directions it offers: an agent
 * presenting a plan already holds the whole thing, and an agent reporting a
 * pull request already holds that too. Roster is never asked to read a plan
 * back through here — proposing one hands it over so a research turn can end,
 * and reporting a pull request records the one fact Roster could not have
 * worked out for itself: where the work ended up, as a link rather than
 * something scraped out of prose.
 */
export interface PlanTools {
  /**
   * Present a plan for review, ending the research turn that wrote it.
   *
   * The session is bound by the caller rather than passed as an argument:
   * which session a plan belongs to is Roster's fact, not the agent's to
   * choose.
   */
  propose(body: string): Plan

  /**
   * How far the session's current plan has got, or null when it has none.
   *
   * The one read this interface offers, and it exists because proposing is
   * destructive: a capture rewrites the session's newest plan in place and
   * resets it to a draft. `propose` alone cannot tell whether that would undo
   * work already under way, so the caller says.
   */
  currentStatus(): PlanStatus | null

  recordPullRequest(planId: string, input: { url: string; branch?: string }): Plan
}

/**
 * Every tool this server registers, as the SDK namespaces them.
 *
 * Exported so the runner's allowlist cannot drift from what is registered: a
 * tool missing from here does not fail loudly, it silently blocks on the
 * approval gate forever.
 */
export const PLAN_TOOL_NAMES = [
  'mcp__plans__propose_plan',
  'mcp__plans__record_pull_request',
] as const

export const PROPOSE_PLAN_SCHEMA = {
  plan: z
    .string()
    .describe(
      'The plan itself, as Markdown. Open with a heading naming what you propose to do — ' +
        'that heading becomes the plan’s title.',
    ),
}

export const RECORD_PR_SCHEMA = {
  plan_id: z.string().describe('The id of the plan you were asked to build.'),
  url: z.string().describe('The URL of the pull request you opened.'),
  branch: z
    .string()
    .optional()
    .describe('The branch it was opened from, if not the one you were given.'),
}

/**
 * Builds the in-process MCP server for plans.
 *
 * Created lazily with the SDK's own factory so the module graph does not pull
 * in the SDK runtime for callers that only normalise events.
 */
export async function createPlansMcpServer(plans: PlanTools): Promise<unknown> {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')

  return createSdkMcpServer({
    name: PLANS_SERVER,
    version: '1.0.0',
    tools: buildPlanTools(plans, tool),
  })
}

type ToolFactory = typeof import('@anthropic-ai/claude-agent-sdk').tool

/**
 * The tool definitions themselves, given a factory to build them with.
 *
 * Exported so the handlers can be exercised without standing up the SDK.
 */
export function buildPlanTools(plans: PlanTools, tool: ToolFactory) {
  const text = (body: string, isError = false) => ({
    content: [{ type: 'text' as const, text: body }],
    ...(isError ? { isError: true } : {}),
  })

  const proposePlan = tool(
    'propose_plan',
    'Present your plan for review and end the turn. Call this once your research is done. Do not start the work.',
    PROPOSE_PLAN_SCHEMA,
    async (args: { plan: string }) => {
      const body = args.plan.trim()
      if (body === '') {
        return text('A plan cannot be empty. Put the plan itself in `plan`.', true)
      }

      // A capture rewrites the session's newest plan and resets it to a
      // draft, keeping the branch and pull request it had already picked up.
      // On a plan that has moved past review that is pure damage: you would
      // be offered "Approve & build" again on work that is already building
      // or already up for review, and settleBuild cannot undo it because it
      // only matches a plan still reading 'building'. Refusing here rather
      // than in the store keeps the reset available to the revise flow,
      // which is what it is for.
      const status = plans.currentStatus()
      if (status === 'building' || status === 'in_review') {
        return text(
          `This session's plan is already ${status === 'building' ? 'being built' : 'up for review'}, ` +
            'so it cannot be replaced. Carry on with the work you were given, and report the ' +
            'pull request with record_pull_request when it exists.',
          true,
        )
      }

      const plan = plans.propose(body)
      return text(
        `Presented "${plan.title}" for review. Stop here — you will be told whether to build it.`,
      )
    },
  )

  const recordPullRequest = tool(
    'record_pull_request',
    'Report the pull request you opened for a plan, so Roster can link to it. Call this once the PR exists.',
    RECORD_PR_SCHEMA,
    async (args: { plan_id: string; url: string; branch?: string }) => {
      if (!isHttpUrl(args.url)) {
        return text(`"${args.url}" is not a URL. Pass the pull request's full https address.`, true)
      }

      try {
        const plan = plans.recordPullRequest(args.plan_id, {
          url: args.url,
          ...(args.branch !== undefined ? { branch: args.branch } : {}),
        })
        return text(`Recorded. "${plan.title}" is now up for review.`)
      } catch {
        // An error the agent can read and act on beats one that kills the turn.
        return text(`No plan with id "${args.plan_id}".`, true)
      }
    },
  )

  return [proposePlan, recordPullRequest]
}

/** A pull request lives at an address, and the modal turns this into a link. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
