import { parseMentions } from '../../../shared/mentions'
import { taskPriorityLabel, taskStatusLabel } from '../../../shared/tasks'
import type {
  Agent,
  Session,
  Task,
  TaskComment,
  TaskSessionLink,
} from '../../../shared/types'
import type { SessionStore } from '../store/sessions'
import type { TaskStore } from '../store/tasks'

/**
 * The slice of SessionManager this needs.
 *
 * Narrow on purpose: a turn can then be driven in a test by a spy, without
 * standing up a runner or the SDK.
 */
export interface MentionRunner {
  send(sessionId: string, prompt: string): Promise<void>
}

/**
 * Mentioning an agent in a task's comment thread.
 *
 * The mechanism is `SessionManager.handOff` with a task as the origin: a
 * session is opened on the mentioned agent, its transcript opens with a
 * brief saying why it exists, and the turn runs. Mentioning the same agent
 * again continues that session, so it still remembers what it was asked
 * about this task an hour ago.
 *
 * Only a comment written by a person reaches here. An agent's own comments
 * are inert, which is what stops one agent's answer mentioning another and
 * looping forever.
 */
export class TaskMentions {
  constructor(
    /** A function, not the store: the roster lives in agent.toml, and reloads. */
    private readonly roster: () => Agent[],
    private readonly sessions: SessionStore,
    private readonly tasks: TaskStore,
    private readonly runner: MentionRunner,
    private readonly onAttached: (link: TaskSessionLink) => void = () => {},
  ) {}

  /**
   * Sends a comment to every agent it mentions.
   *
   * The returned promise settles when every turn has finished, which is why
   * the IPC handler discards it with `void` — posting a comment must not
   * wait for an agent to think. Tests await it.
   */
  async dispatch(taskId: string, text: string): Promise<void> {
    const task = this.tasks.findById(taskId)
    if (!task) return

    const roster = this.roster()
    const mentioned = parseMentions(
      text,
      roster.map((agent) => agent.id),
    )
    if (mentioned.length === 0) return

    await Promise.all(
      mentioned.map((mention) => {
        const agent = roster.find((candidate) => candidate.id === mention.agentId)
        // Type-narrowing guard: parseMentions is given roster.map(a => a.id) as its
        // whitelist, so every mention it returns is found by roster.find().
        return agent ? this.ask(task, agent, text) : Promise.resolve()
      }),
    )
  }

  /**
   * Asks one agent, containing every failure so `dispatch` never rejects.
   *
   * `dispatch` is called as `void mentions.dispatch(...)` from the comment
   * handler — nothing awaits it, so a rejection here would surface as an
   * unhandled promise rejection in the main process rather than as anything
   * a user could see. Opening the session (a unique-index race, an FK
   * violation) is exactly as fallible as sending the turn, so it gets the
   * same containment: report the failure into the thread, the way a failed
   * turn already does.
   */
  private async ask(task: Task, agent: Agent, comment: string): Promise<void> {
    let session: Session
    try {
      session = this.sessions.findByTask(task.id, agent.id) ?? this.open(task, agent)
    } catch (cause) {
      this.safePost(task.id, agent, failureFor(agent, cause))
      return
    }

    // What the session held before this turn, so the reply is this turn's
    // prose and not the answer to the last question.
    const before = this.sessions.messages(session.id).length

    try {
      // The key leads, so a resumed session knows which task is being asked
      // about without re-reading the brief.
      await this.runner.send(session.id, `On ${task.id}: ${comment}`)
    } catch (cause) {
      this.safePost(task.id, agent, failureFor(agent, cause))
      return
    }

    const reply = this.replySince(session.id, before)
    this.safePost(
      task.id,
      agent,
      reply === ''
        ? `Answered in "${session.title}" — nothing to quote here.`
        : reply,
    )
  }

  /**
   * `post`, but swallowing its own failure.
   *
   * Reached only when the store that would carry the failure message is
   * itself the thing that broke — there is no thread left to write into, and
   * letting that second error escape would still leave `dispatch` rejecting,
   * which is the exact outcome this containment exists to prevent.
   */
  private safePost(taskId: string, agent: Agent, text: string): void {
    try {
      this.post(taskId, agent, text)
    } catch {
      // Nothing left to report to; dropping this is the least-bad outcome.
    }
  }

  /**
   * The agent's prose from this turn, joined.
   *
   * Joined rather than reduced to the last message because SessionManager
   * flushes buffered text in chunks — taking only the final one would post
   * the last paragraph of an answer and drop the rest. Tool calls are left
   * out: they are how the answer was reached, not the answer.
   */
  private replySince(sessionId: string, before: number): string {
    return this.sessions
      .messages(sessionId)
      .slice(before)
      .flatMap((message) =>
        message.kind === 'text' && message.role === 'assistant' ? [message.text.trim()] : [],
      )
      .filter((text) => text !== '')
      .join('\n\n')
  }

  private post(taskId: string, agent: Agent, text: string): void {
    this.tasks.comment(taskId, { author: agent.name, tone: 'agent', text })
  }

  private open(task: Task, agent: Agent): Session {
    const session = this.sessions.create({
      agentId: agent.id,
      title: `${task.id} — ${task.title}`,
      // Always 'you': by design only a person's comment dispatches.
      origin: 'you',
      taskId: task.id,
    })

    // The transcript opens by saying why it exists, exactly as a handoff's
    // does. `to` is omitted — a SessionRef points at an agent and a session,
    // and this one's origin is a task, which `session.taskId` already holds.
    this.sessions.append({
      sessionId: session.id,
      kind: 'spawn',
      from: 'You',
      text: briefFor(task, this.tasks.comments(task.id)),
    })

    this.onAttached({
      taskId: task.id,
      agentId: agent.id,
      sessionId: session.id,
      createdAt: session.createdAt,
    })

    return session
  }
}

/**
 * What a mentioned agent is told when its session opens.
 *
 * Exported because it is the whole value of the first message and deserves
 * its own tests. History lines are left out: the agent was asked a question,
 * not handed an audit log.
 */
export function briefFor(task: Task, thread: readonly TaskComment[]): string {
  const lines = [
    `You have been mentioned on ${task.id} — ${task.title}.`,
    '',
    `Status: ${taskStatusLabel(task.status)}`,
    `Priority: ${taskPriorityLabel(task.priority)}`,
    '',
    task.description.trim() === '' ? '(no description)' : task.description,
  ]

  const written = thread.filter((entry) => !entry.isSystem)
  if (written.length > 0) {
    lines.push('', 'The thread so far:')
    for (const entry of written) lines.push(`- ${entry.author}: ${entry.text}`)
  }

  lines.push('', 'Answer here. Your reply is posted back to the task.')
  return lines.join('\n')
}

/** SessionManager's wording for a session that has not finished its turn. */
const ALREADY_RUNNING = 'this session is already running'

/**
 * Why an answer did not arrive, as a sentence for the thread.
 *
 * An asynchronous failure can no longer reject the IPC call, so this is the
 * only place it can surface.
 */
function failureFor(agent: Agent, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)

  return message === ALREADY_RUNNING
    ? `${agent.name} is still working on your last question.`
    : `Couldn't answer — ${message}`
}
