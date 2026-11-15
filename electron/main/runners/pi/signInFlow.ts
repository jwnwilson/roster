import { randomUUID } from 'node:crypto'
import type {
  SignInAnswer,
  SignInEvent,
  SignInMethod,
  SignInResult,
} from '../../../../shared/types'
import type { ApprovalDecision } from '../types'
import { loginInteraction, type LoginInteraction, type SignInApproval } from './signIn'

export interface SignInFlowDeps {
  /** Runs Pi's login for the provider, answering through `interaction`. */
  login(providerId: string, method: SignInMethod, interaction: LoginInteraction, signal: AbortSignal): Promise<SignInResult>
  openUrl(url: string): void
  /** Sends an event to the window. */
  emit(event: SignInEvent): void
  /** Runs once a sign-in succeeds, so runner status is re-read. */
  afterSignIn(): Promise<void>
}

/**
 * One sign-in at a time, from outside any conversation.
 *
 * Pi's login asks its questions through `loginInteraction`; here each question
 * becomes a prompt sent to the window, and the window's answer resolves it.
 * Pi's OAuth callback port is single-use, so a second sign-in while one is
 * running is refused rather than queued.
 */
export class PiSignInFlow {
  private active: { controller: AbortController; pending: Map<string, (d: ApprovalDecision) => void> } | null =
    null

  constructor(private readonly deps: SignInFlowDeps) {}

  async start(providerId: string, method: SignInMethod): Promise<SignInResult> {
    if (this.active) {
      return { ok: false, message: 'A sign-in is already in progress. Finish or cancel it first.' }
    }

    const controller = new AbortController()
    const pending = new Map<string, (d: ApprovalDecision) => void>()
    this.active = { controller, pending }

    const closeAll = (reason: string) => {
      for (const done of [...pending.values()]) done({ approved: false, reason })
    }
    controller.signal.addEventListener('abort', () => closeAll('cancelled'), { once: true })

    const ask = (approval: SignInApproval, signal?: AbortSignal): Promise<ApprovalDecision> => {
      const id = randomUUID()
      const question = approval.questions?.[0]
      return new Promise<ApprovalDecision>((resolve) => {
        const done = (decision: ApprovalDecision) => {
          if (pending.delete(id)) this.deps.emit({ type: 'prompt-closed', id })
          resolve(decision)
        }
        pending.set(id, done)
        signal?.addEventListener('abort', () => done({ approved: false, reason: 'withdrawn' }), { once: true })
        if (question === undefined) {
          done({ approved: false, reason: 'no question to answer' })
          return
        }
        this.deps.emit({ type: 'prompt', prompt: { id, question, secret: approval.secret === true } })
      })
    }

    const interaction = loginInteraction({
      signal: controller.signal,
      openUrl: (url) => this.deps.openUrl(url),
      ask,
      tell: (approval) => this.deps.emit({ type: 'notice', text: approval.command }),
    })

    try {
      const result = await this.deps.login(providerId, method, interaction, controller.signal)
      if (result.ok) await this.deps.afterSignIn()
      return result
    } finally {
      closeAll('finished')
      this.active = null
    }
  }

  /** Answers the prompt with this id. False when no such prompt is waiting. */
  answer(promptId: string, answer: SignInAnswer): boolean {
    const done = this.active?.pending.get(promptId)
    if (!done) return false
    const answers = sanitizeAnswers(answer.answers)
    done({ approved: answer.approved === true, ...(answers ? { answers } : {}) })
    return true
  }

  cancel(): void {
    this.active?.controller.abort()
  }
}

/** The window's answers are untrusted input: only string values are kept. */
function sanitizeAnswers(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const kept = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return Object.fromEntries(kept)
}
