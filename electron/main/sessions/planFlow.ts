import type { Plan } from '../../../shared/types'
import { EXIT_PLAN_MODE } from '../../../shared/plans'
import type { PlanStore } from '../store/plans'
import type { SessionManager } from './manager'
import {
  APPROVED_REASON,
  branchFor,
  buildPrompt,
  reviseReason,
  revisePrompt,
  type PlanPromptInput,
} from './planPrompt'

/**
 * Who a note from the app is filed as.
 *
 * Decided here rather than taken from the renderer, for the same reason the
 * board decides it in the IPC layer: otherwise a renderer could file a note
 * as though an agent had written it.
 */
const YOU = { author: 'You', tone: 'you' } as const

/**
 * The two things you can do with a plan: send it back, or accept it.
 *
 * Both need a turn from the agent that wrote it, and both may find that agent
 * still blocked on the very ExitPlanMode call that produced the plan. That is
 * the whole reason this is a class of its own rather than two IPC handlers —
 * the sequencing is the hard part and is worth testing without Electron.
 */
export class PlanFlow {
  constructor(
    private readonly plans: PlanStore,
    private readonly manager: Pick<
      SessionManager,
      'pendingApprovals' | 'respondToApproval' | 'enqueue'
    >,
  ) {}

  /**
   * Sends your notes to the agent, which revises the plan and presents it
   * again.
   *
   * When it is still waiting on its ExitPlanMode, the notes go back as the
   * reason it was refused: that is the existing "keep planning" path, and it
   * costs no extra turn.
   */
  submit(planId: string, text: string): Plan {
    const plan = this.require(planId)

    const note = text.trim()
    if (note === '') throw new Error('a comment cannot be empty')

    this.plans.comment(planId, { ...YOU, text: note })

    const input = this.promptInput(plan)
    const blocked = this.blockedOnPlan(plan)

    if (blocked) {
      this.manager.respondToApproval(plan.sessionId, blocked, {
        approved: false,
        reason: reviseReason(input),
      })
    } else {
      this.manager.enqueue(plan.sessionId, revisePrompt(input), { planMode: true })
    }

    return this.plans.setStatus(planId, 'revising')
  }

  /**
   * Accepts the plan and sends the agent to build it.
   *
   * The build cannot happen inside the planning turn — plan mode refuses
   * every edit for its whole life — so a pending call is refused and the work
   * is queued as its own turn behind it.
   */
  approve(planId: string): Plan {
    const plan = this.require(planId)
    if (plan.status === 'building' || plan.status === 'in_review') {
      throw new Error(`plan "${planId}" has already been approved`)
    }

    const blocked = this.blockedOnPlan(plan)
    if (blocked) {
      this.manager.respondToApproval(plan.sessionId, blocked, {
        approved: false,
        reason: APPROVED_REASON,
      })
    }

    this.manager.enqueue(plan.sessionId, buildPrompt(this.promptInput(plan)))

    return this.plans.setStatus(planId, 'building', { branch: branchFor(plan) })
  }

  /* ---- helpers ----------------------------------------------------------- */

  private require(planId: string): Plan {
    const plan = this.plans.findById(planId)
    if (!plan) throw new Error(`unknown plan "${planId}"`)
    return plan
  }

  /**
   * The id of the ExitPlanMode this agent is still waiting on, if any.
   *
   * Matched on the tool name, never on "there is an approval pending":
   * answering a blocked Bash call with plan notes would run the command.
   */
  private blockedOnPlan(plan: Plan): string | null {
    const approval = this.manager
      .pendingApprovals(plan.sessionId)
      .find((pending) => pending.toolName === EXIT_PLAN_MODE)

    return approval ? approval.id : null
  }

  private promptInput(plan: Plan): PlanPromptInput {
    return {
      plan,
      body: this.plans.body(plan.id),
      comments: this.plans.comments(plan.id),
    }
  }
}
