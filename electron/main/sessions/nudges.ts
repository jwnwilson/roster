import type { SessionStore } from '../store/sessions'

/** Check often enough to recover forgotten work without creating a chat loop. */
export const NUDGE_PERIOD_MS = 15 * 60 * 1_000

export const NUDGE_PROMPT =
  'Roster check-in: this task is still assigned to you and In Progress. Continue the work if useful; otherwise leave a concise blocker or next-step comment and update the task status to reflect its current state.'

export interface NudgeRunner {
  isStreaming(sessionId: string): boolean
  enqueue(sessionId: string, prompt: string, options?: { author?: string }): void
}

/**
 * Periodically brings an assigned, in-progress task back to its agent.
 *
 * This is intentionally not a daemon: it runs only while Roster is open and
 * only starts a normal queued turn. The agent, rather than the timer, remains
 * responsible for comments and board status changes.
 */
export class SessionNudges {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly sessions: SessionStore,
    private readonly runner: NudgeRunner,
    private readonly now: () => number = Date.now,
    private readonly everyMs = NUDGE_PERIOD_MS,
  ) {}

  start(): void {
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => this.tick(), this.everyMs)
    this.timer.unref()
  }

  dispose(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  tick(): void {
    const at = this.now()
    for (const session of this.sessions.livenessCandidates(at - this.everyMs)) {
      if (this.runner.isStreaming(session.id)) continue
      this.sessions.markNudged(session.id, at)
      this.runner.enqueue(session.id, NUDGE_PROMPT, { author: 'Roster' })
    }
  }
}
