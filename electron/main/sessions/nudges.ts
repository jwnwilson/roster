import type { SessionStore } from '../store/sessions'
import type { TaskStore } from '../store/tasks'
import type { TaskSessionLink } from '../../../shared/types'
import { briefFor } from './mentions'

/** Check often enough to recover forgotten work without creating a chat loop. */
export const NUDGE_PERIOD_MS = 5 * 60 * 1_000

export const NUDGE_PROMPT =
  'Roster check-in: this task is still assigned to you and In Progress. Continue the work if useful; otherwise leave a concise blocker or next-step comment and update the task status to reflect its current state.'

export interface NudgeRunner {
  isStreaming(sessionId: string): boolean
  enqueue(sessionId: string, prompt: string, options?: { author?: string }): void
}

interface TaskRecovery {
  tasks: TaskStore
  agentExists(agentId: string): boolean
  onAttached(link: TaskSessionLink): void
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
    private readonly recovery?: TaskRecovery,
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
    if (this.recovery) {
      for (const task of this.recovery.tasks.findAll()) {
        if (task.status !== 'in_progress' || !task.assigneeId) continue
        if (!this.recovery.agentExists(task.assigneeId)) continue
        if (this.sessions.findByTask(task.id, task.assigneeId)) continue
        const session = this.sessions.create({
          agentId: task.assigneeId,
          title: `${task.id} — ${task.title}`,
          origin: 'you',
          taskId: task.id,
          projectId: task.projectId,
        })
        this.recovery.onAttached({
          taskId: task.id,
          agentId: task.assigneeId,
          sessionId: session.id,
          createdAt: session.createdAt,
        })
      }
    }
    for (const session of this.sessions.livenessCandidates(at - this.everyMs)) {
      if (this.recovery && !this.recovery.agentExists(session.agentId)) continue
      if (this.runner.isStreaming(session.id)) continue
      const task = session.taskId ? this.recovery?.tasks.findById(session.taskId) : null
      const prompt = task && this.recovery
        ? briefFor(task, this.recovery.tasks.comments(task.id), NUDGE_PROMPT, 'check-in')
        : NUDGE_PROMPT
      this.sessions.markNudged(session.id, at)
      this.runner.enqueue(session.id, prompt, { author: 'Roster' })
    }
  }
}
