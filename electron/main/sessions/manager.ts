import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { Agent, Approval, Message, Session, Usage } from '../../../shared/types'
import { isBuiltinMcpServer, PLANS_SERVER, TASKS_SERVER } from '../../../shared/mcp'
import { EXIT_PLAN_MODE, planFromToolInput } from '../../../shared/plans'
import type { AgentStore } from '../store/agents'
import type { McpStore } from '../store/mcp'
import type { SessionStore } from '../store/sessions'
import type { SkillStore } from '../store/skills'
import type { UsageStore } from '../store/usage'
import type { TaskStore } from '../store/tasks'
import type { ProjectStore } from '../store/projects'
import type { PlanStore } from '../store/plans'
import { getRunner } from '../runners/registry'
import type { ApprovalDecision, McpLaunchSpec, RunnerEvent } from '../runners/types'
import { ClaudeRunner } from '../runners/claude'
import { createRosterMcpServer } from '../runners/handoffTool'
import { createTasksMcpServer, type TaskTools } from '../runners/taskTools'
import { createPlansMcpServer, type PlanTools } from '../runners/planTools'
import { describeActivity, THINKING } from './activity'

/** Per-turn choices the caller makes, rather than the agent's configuration. */
export interface SendOptions {
  /** Research and propose only; see StartOptions.planMode. */
  planMode?: boolean
}

/** Everything the manager emits so the renderer can follow a live turn. */
export type SessionEvent =
  | { type: 'message'; sessionId: string; message: Message }
  | { type: 'message-updated'; sessionId: string; message: Message }
  | { type: 'status'; sessionId: string; status: Session['status'] }
  | { type: 'usage'; sessionId: string; usage: Usage }
  | { type: 'approval'; sessionId: string; approval: Approval }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string }
  | { type: 'streaming'; sessionId: string; active: boolean }
  /** What the agent is doing right now, for the streaming indicator. */
  | { type: 'activity'; sessionId: string; text: string }

/**
 * Streamed prose arrives token by token. Writing and broadcasting each one
 * would mean a SQLite write and a React render per token; the buffer flushes
 * on a short interval instead, so cost is bounded by time rather than by how
 * fast the model talks.
 */
const FLUSH_INTERVAL_MS = 60

/**
 * How long `stop` waits for a turn to finish writing before going ahead
 * without it.
 *
 * Long enough that an unwinding stream is never cut short, short enough that
 * a runner ignoring its abort signal cannot wedge a delete for good.
 */
const STOP_TIMEOUT_MS = 10_000

/** Unref'd, so a stop that is still waiting can never hold the process open. */
function afterStopTimeout(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, STOP_TIMEOUT_MS).unref()
  })
}

interface ActiveRun {
  abort: AbortController
  /** Tool messages awaiting their result, keyed by the runner's tool id. */
  toolMessages: Map<string, Message>
  /** When each of those calls started, so its row can report how long it took. */
  toolStartedAt: Map<string, number>
  /** Approvals raised during this run. */
  approvals: Map<string, Approval>
  runnerId: string
  /** Prose received but not yet written or broadcast. */
  pendingText: string
  flushTimer: NodeJS.Timeout | null
  /**
   * Settles once the turn has finished writing, not merely once the stream
   * has stopped. `stop` waits on this, so that a caller about to delete the
   * session knows nothing else will write to it.
   */
  done: Promise<void>
  finish: () => void
}

/**
 * Drives one turn of an agent: resolves its runner, streams events, persists
 * everything to SQLite, and republishes to the renderer.
 *
 * This is the only place that knows a turn is in progress — the stores hold
 * finished state, the runner holds none.
 */
export class SessionManager {
  private active = new Map<string, ActiveRun>()
  private listeners = new Set<(event: SessionEvent) => void>()
  /** Turns Roster owes a session once its current one ends. See enqueue. */
  private queued = new Map<string, { prompt: string; options: SendOptions }>()

  constructor(
    private readonly agents: AgentStore,
    private readonly sessions: SessionStore,
    private readonly skills: SkillStore,
    private readonly mcp: McpStore,
    private readonly usage: UsageStore,
    /**
     * The shared task board. Optional because handing an agent the task
     * tools is a separate concern from running a turn — a manager without
     * one simply exposes no task tools.
     */
    private readonly board?: { tasks: TaskStore; projects: ProjectStore },
    /**
     * Where plans are kept. Optional for the same reason as the board: a
     * manager without one runs turns exactly as before and captures nothing.
     */
    private readonly plans?: PlanStore,
  ) {}

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  /* ---- session lifecycle ------------------------------------------------ */

  create(agentId: string, title = 'New session'): Session {
    return this.sessions.create({ agentId, title, origin: 'you' })
  }

  /**
   * Opens a session on another agent — how one agent hands work to another.
   *
   * Both sides are recorded: the new session gets a spawn message naming its
   * origin, and the handing-off session gets a handoff message linking to it.
   */
  handOff(input: {
    fromAgentId: string
    fromSessionId: string
    toAgentId: string
    title: string
    brief: string
  }): { session: Session; label: string } {
    const from = this.agents.findById(input.fromAgentId)
    const to = this.agents.findById(input.toAgentId)
    const fromLabel = from ? `${from.name} · ${input.title}` : input.title
    const toLabel = to ? `${to.name} · ${input.title}` : input.title

    const session = this.sessions.create({
      agentId: input.toAgentId,
      title: input.title,
      origin: 'agent',
      from: { agentId: input.fromAgentId, sessionId: input.fromSessionId, label: fromLabel },
    })

    // The receiving session opens with why it exists and a way back.
    this.record(session.id, {
      sessionId: session.id,
      kind: 'spawn',
      from: from?.name ?? 'another agent',
      text: input.brief,
      to: {
        agentId: input.fromAgentId,
        sessionId: input.fromSessionId,
        label: fromLabel,
      },
    })

    // The handing-off session gets a pill linking forward.
    this.record(input.fromSessionId, {
      sessionId: input.fromSessionId,
      kind: 'handoff',
      links: [
        {
          agentId: input.toAgentId,
          sessionId: session.id,
          label: toLabel,
          status: session.status,
        },
      ],
    })

    return { session, label: toLabel }
  }

  isStreaming(sessionId: string): boolean {
    return this.active.has(sessionId)
  }

  /* ---- running a turn --------------------------------------------------- */

  /**
   * Runs a prompt now, or as soon as the turn in flight ends.
   *
   * Every turn used to originate from someone pressing send, so refusing one
   * while another was live was the whole of the story. Roster now starts
   * turns of its own — revising a plan, building an approved one — and it
   * cannot ask the person who clicked to wait for the agent to fall quiet
   * first.
   *
   * One queued turn per session: a second replaces the first, because these
   * are instructions about the same plan and the newest is the one meant.
   * Nothing awaits this, so a failure is recorded on the session rather than
   * thrown into a promise no one is holding.
   */
  enqueue(sessionId: string, prompt: string, options: SendOptions = {}): void {
    if (this.active.has(sessionId)) {
      this.queued.set(sessionId, { prompt, options })
      return
    }

    void this.send(sessionId, prompt, options).catch((cause: unknown) => {
      // A session that has gone has nowhere to show an error; anything else
      // belongs in its transcript where it can be seen.
      if (!this.sessions.findById(sessionId)) return
      this.failTurn(sessionId, cause instanceof Error ? cause.message : String(cause))
    })
  }

  async send(sessionId: string, prompt: string, options: SendOptions = {}): Promise<void> {
    if (this.active.has(sessionId)) throw new Error('this session is already running')

    const session = this.sessions.findById(sessionId)
    if (!session) throw new Error(`unknown session "${sessionId}"`)

    const agent = this.agents.findById(session.agentId)
    if (!agent) throw new Error(`unknown agent "${session.agentId}"`)

    const runner = getRunner(agent.runner)
    if (!runner) {
      this.failTurn(sessionId, `no runner is registered for "${agent.runner}"`)
      return
    }

    // The user's own message is persisted before the run, so it survives a
    // crash mid-turn.
    this.record(sessionId, { sessionId, kind: 'text', role: 'user', who: 'you', text: prompt })

    let finish = (): void => {}
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })

    const run: ActiveRun = {
      abort: new AbortController(),
      toolMessages: new Map(),
      toolStartedAt: new Map(),
      approvals: new Map(),
      runnerId: agent.runner,
      pendingText: '',
      flushTimer: null,
      done,
      finish,
    }
    this.active.set(sessionId, run)

    // The try opens here rather than at the runner call: the MCP servers
    // below are built with await, and a throw there used to escape send()
    // with the run still in `active` and its `done` promise unresolved —
    // which is precisely what stop() waits on before a session is deleted.
    try {
      this.setStatus(sessionId, 'running')
      this.emit({ type: 'streaming', sessionId, active: true })
      this.emit({ type: 'activity', sessionId, text: THINKING })

      // Only the Claude runner supports in-process MCP, so only it can be
      // given Roster's own servers; other runners simply cannot hand off yet.
      let inProcessMcpServers: Record<string, unknown> | undefined
      if (runner instanceof ClaudeRunner) {
        runner.onApprovalNeeded = (event) => this.raiseApproval(sessionId, run, event)
        inProcessMcpServers = {
          roster: await createRosterMcpServer(
            {
              listAgents: () => this.agents.findAll(),
              openSession: ({ toAgentId, title, brief }) => {
                const result = this.handOff({
                  fromAgentId: agent.id,
                  fromSessionId: sessionId,
                  toAgentId,
                  title,
                  brief,
                })
                return { sessionId: result.session.id, label: result.label }
              },
            },
            agent.id,
          ),
        }

        // The board is opt-in per agent, like any other MCP server. An agent
        // that does not enable it is never given the tools at all, so there is
        // nothing for it to be refused.
        const tasks = this.taskToolsFor(agent)
        if (tasks) {
          inProcessMcpServers[TASKS_SERVER] = await createTasksMcpServer(tasks, agent.id)
        }

        // Reporting a pull request is opt-in the same way. Without it a plan
        // still gets built; Roster simply never learns where the work landed.
        const planTools = this.planToolsFor(agent)
        if (planTools) {
          inProcessMcpServers[PLANS_SERVER] = await createPlansMcpServer(planTools)
        }
      }

      const stream = runner.run(prompt, {
        cwd: agent.cwd,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        skillPaths: this.skillPathsFor(agent),
        mcpServers: this.mcpServersFor(agent),
        signal: run.abort.signal,
        ...(options.planMode === true ? { planMode: true } : {}),
        ...(inProcessMcpServers ? { inProcessMcpServers } : {}),
        ...(session.runnerSessionId !== undefined ? { resumeFrom: session.runnerSessionId } : {}),
      })

      for await (const event of stream) this.handle(sessionId, run, event)
    } catch (cause) {
      this.failTurn(sessionId, cause instanceof Error ? cause.message : String(cause))
    } finally {
      // Whatever is still buffered belongs to this turn, not the next.
      this.flushText(sessionId, run)
      this.active.delete(sessionId)
      this.emit({ type: 'streaming', sessionId, active: false })
      if (this.sessions.findById(sessionId)?.status === 'running') {
        this.setStatus(sessionId, 'done')
      }
      // Only when nothing is waiting: approving a plan queues the build behind
      // the planning turn, and settling here would cancel it before it ran.
      if (!this.queued.has(sessionId)) this.settleBuild(sessionId)
      // Last, and after every write above: anyone waiting on this turn is
      // waiting to be sure the session is no longer being written to.
      run.finish()
      this.drain(sessionId)
    }
  }

  /**
   * Hands a plan back when its build turn ended without a pull request.
   *
   * The agent may have refused, run out of road, or simply stopped. Whatever
   * the reason, a plan left marked as building is a dead end: that state
   * offers neither comments nor approval, so there is no way to answer it.
   * Better to say what happened and put it back in your hands.
   */
  private settleBuild(sessionId: string): void {
    const plans = this.plans
    if (!plans) return

    const building = plans
      .listBySession(sessionId)
      .find((plan) => plan.status === 'building' && plan.prUrl === undefined)
    if (!building) return

    plans.comment(building.id, {
      author: this.agentNameFor(sessionId),
      tone: 'agent',
      text: 'The build ended without opening a pull request.',
    })
    // The branch is kept, so approving again continues the same work rather
    // than starting a second one beside it.
    plans.setStatus(building.id, 'draft')
  }

  /**
   * Starts whatever was queued behind the turn that just ended.
   *
   * Deliberately not awaited: the queued turn is its own turn, and the
   * caller of send() is owed only the one it asked for.
   */
  private drain(sessionId: string): void {
    const next = this.queued.get(sessionId)
    if (!next) return

    this.queued.delete(sessionId)
    this.enqueue(sessionId, next.prompt, next.options)
  }

  cancel(sessionId: string): void {
    this.active.get(sessionId)?.abort.abort()
  }

  /**
   * Brings a session to a halt and waits for it to get there.
   *
   * `cancel` only raises the signal; the turn goes on writing until the
   * runner's stream unwinds. Deleting a session in that window would leave
   * the tail of a turn inserting rows against an id that has gone, so this
   * is what a delete waits on. The queued turn is dropped too — resuming a
   * session somebody is stopping is never what was meant.
   *
   * Resolves immediately when nothing is running, including for a session
   * that does not exist.
   *
   * The wait is bounded. A runner that never honours its abort signal would
   * otherwise hold the caller for good — the delete waiting on this would
   * never return and the control that asked for it would read as dead. Past
   * the timeout the delete goes ahead: a turn still unwinding then finds its
   * session gone, which `enqueue` already treats as nothing to report.
   */
  async stop(sessionId: string): Promise<void> {
    this.queued.delete(sessionId)

    const run = this.active.get(sessionId)
    if (!run) return

    run.abort.abort()
    await Promise.race([run.done, afterStopTimeout()])
  }

  /* ---- event handling ---------------------------------------------------- */

  private handle(sessionId: string, run: ActiveRun, event: RunnerEvent): void {
    switch (event.kind) {
      case 'text':
        this.bufferAssistantText(sessionId, run, event.delta)
        return

      case 'tool': {
        // Anything said before the tool call belongs above it in the
        // transcript, so flush before writing the tool row.
        this.flushText(sessionId, run)
        // The same plan also arrives through the approval callback, in no
        // guaranteed order. Capture is idempotent, so whichever gets here
        // first creates it and the other simply finds it.
        const proposed =
          event.name === EXIT_PLAN_MODE ? planFromToolInput(event.input) : null
        const planId = proposed === null ? null : this.capturePlan(sessionId, proposed)

        const message = this.record(sessionId, {
          sessionId,
          kind: 'tool',
          tool: event.name,
          args: event.args,
          ...(event.input !== undefined ? { input: event.input } : {}),
          ...(planId !== null ? { planId } : {}),
          output: '',
          isError: false,
        })
        run.toolMessages.set(event.id, message)
        run.toolStartedAt.set(event.id, Date.now())
        this.emit({
          type: 'activity',
          sessionId,
          text: describeActivity(event.name, event.args),
        })
        return
      }

      case 'result': {
        const message = run.toolMessages.get(event.id)
        if (!message || message.kind !== 'tool') return

        // The tool row was written when the call started; fill in its result
        // and how long it took, which the row shows on its right.
        const startedAt = run.toolStartedAt.get(event.id)
        const updated: Message = {
          ...message,
          output: event.output,
          isError: event.isError,
          ...(startedAt !== undefined ? { durationMs: Date.now() - startedAt } : {}),
        }
        run.toolMessages.delete(event.id)
        run.toolStartedAt.delete(event.id)
        this.sessions.update(updated)
        this.emit({ type: 'message-updated', sessionId, message: updated })
        // Back to thinking unless another tool is still running.
        if (run.toolMessages.size === 0) {
          this.emit({ type: 'activity', sessionId, text: THINKING })
        }
        return
      }

      case 'approval':
        // Raised through the runner callback, not the stream, so nothing here.
        return

      case 'usage': {
        const usage: Usage = {
          sessionId,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          totalTokens: event.totalTokens,
          costUsd: event.costUsd,
        }
        // Persist as well as emit, or the totals vanish on reload.
        this.usage.record(usage)
        this.emit({ type: 'usage', sessionId, usage })
        return
      }

      case 'session':
      case 'done':
        if (event.runnerSessionId !== '') {
          this.sessions.attachRunnerSession(sessionId, event.runnerSessionId)
        }
        return

      case 'error':
        this.failTurn(sessionId, event.message)
        return
    }
  }

  /**
   * Buffers a delta and schedules a flush. Deltas that arrive within the
   * interval are written and broadcast together.
   */
  private bufferAssistantText(sessionId: string, run: ActiveRun, delta: string): void {
    run.pendingText += delta
    if (run.flushTimer !== null) return

    run.flushTimer = setTimeout(() => {
      run.flushTimer = null
      this.flushText(sessionId, run)
    }, FLUSH_INTERVAL_MS)
  }

  /** Writes and broadcasts whatever prose has accumulated. */
  private flushText(sessionId: string, run: ActiveRun): void {
    if (run.flushTimer !== null) {
      clearTimeout(run.flushTimer)
      run.flushTimer = null
    }

    const pending = run.pendingText
    if (pending === '') return
    run.pendingText = ''
    this.appendAssistantText(sessionId, pending)
  }

  /**
   * Assistant prose arrives as many small deltas. Rather than one message per
   * delta, they coalesce into the run's current assistant message.
   */
  private appendAssistantText(sessionId: string, delta: string): void {
    const agentName = this.agentNameFor(sessionId)
    const existing = this.sessions.messages(sessionId).at(-1)

    if (existing?.kind === 'text' && existing.role === 'assistant') {
      const updated: Message = { ...existing, text: existing.text + delta }
      // Persist as well as emit: the emitted text is what the open window
      // shows, the stored text is what a reload shows, and they must agree.
      this.sessions.update(updated)
      this.emit({ type: 'message-updated', sessionId, message: updated })
      return
    }

    this.record(sessionId, {
      sessionId,
      kind: 'text',
      role: 'assistant',
      who: agentName,
      text: delta,
    })
  }

  private raiseApproval(
    sessionId: string,
    run: ActiveRun,
    event: Extract<RunnerEvent, { kind: 'approval' }>,
  ): void {
    const planId = event.plan === undefined ? null : this.capturePlan(sessionId, event.plan)

    const approval: Approval = {
      id: event.id,
      sessionId,
      toolName: event.toolName,
      command: event.command,
      ...(event.questions !== undefined ? { questions: event.questions } : {}),
      ...(planId !== null ? { planId } : {}),
      status: 'pending',
      createdAt: Date.now(),
    }

    run.approvals.set(event.id, approval)
    this.setStatus(sessionId, 'approval')
    this.emit({ type: 'approval', sessionId, approval })
  }

  respondToApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): void {
    const run = this.active.get(sessionId)
    if (!run) return

    const runner = getRunner(run.runnerId)
    runner?.respondToApproval(approvalId, decision)

    run.approvals.delete(approvalId)
    this.emit({ type: 'approval-resolved', sessionId, approvalId })
    // The agent resumes work the moment it is answered.
    if (run.approvals.size === 0) this.setStatus(sessionId, 'running')
  }

  pendingApprovals(sessionId: string): Approval[] {
    return [...(this.active.get(sessionId)?.approvals.values() ?? [])]
  }

  /* ---- helpers ----------------------------------------------------------- */

  private record(sessionId: string, message: Parameters<SessionStore['append']>[0]): Message {
    const stored = this.sessions.append(message)
    this.emit({ type: 'message', sessionId, message: stored })
    return stored
  }

  private setStatus(sessionId: string, status: Session['status']): void {
    this.sessions.updateStatus(sessionId, status)
    this.emit({ type: 'status', sessionId, status })
  }

  /**
   * Records a plan the agent just proposed, and says which one it is.
   *
   * Returns null when this manager has no plan store, or when the session has
   * gone — capturing a plan is worth nothing next to finishing the turn.
   */
  /**
   * The plan tools for this agent, or nothing.
   *
   * Gated on the agent enabling "plans", like the board, and on this manager
   * having a plan store at all.
   */
  private planToolsFor(agent: Agent): PlanTools | undefined {
    const plans = this.plans
    if (!plans || !agent.mcpServers.includes(PLANS_SERVER)) return undefined

    return {
      recordPullRequest: (planId, input) => plans.recordPullRequest(planId, input),
    }
  }

  private capturePlan(sessionId: string, body: string): string | null {
    const session = this.sessions.findById(sessionId)
    if (!this.plans || !session) return null

    return this.plans.capture({ sessionId, agentId: session.agentId, body }).id
  }

  private failTurn(sessionId: string, message: string): void {
    this.record(sessionId, {
      sessionId,
      kind: 'text',
      role: 'assistant',
      who: 'roster',
      text: message,
    })
    this.setStatus(sessionId, 'error')
  }

  /** Fraction of the model's context window consumed, 0..1. */
  usageFor(sessionId: string): Usage | null {
    return this.usage.forSession(sessionId)
  }

  private agentNameFor(sessionId: string): string {
    const session = this.sessions.findById(sessionId)
    if (!session) return 'agent'
    return this.agents.findById(session.agentId)?.name ?? 'agent'
  }

  /**
   * The board, bound to this agent.
   *
   * Every change routes through TaskStore.apply with the agent as the actor,
   * so what an agent does to a task is logged and broadcast exactly as a
   * person's drag would be.
   *
   * Absent when no task store was supplied, and absent when the agent has not
   * enabled the built-in "tasks" server — that is the control over which
   * agents may change the board.
   */
  private taskToolsFor(agent: Agent): TaskTools | undefined {
    const board = this.board
    if (!board) return undefined
    if (!agent.mcpServers.includes(TASKS_SERVER)) return undefined
    const { tasks, projects } = board

    const actor = { name: agent.name, tone: 'agent' as const }

    return {
      list: () => tasks.findAll(),
      find: (taskId) => tasks.findById(taskId),
      comments: (taskId) => tasks.comments(taskId),
      projectName: (projectId) => projects.findById(projectId)?.name ?? null,
      isArchivedProject: (projectId) => projects.findById(projectId)?.archivedAt != null,
      agentName: (agentId) => this.agents.findById(agentId)?.name ?? null,
      create: (input) =>
        tasks.create({
          title: input.title,
          description: input.description,
          priority: input.priority,
          projectId: input.projectId,
        }),
      update: (taskId, patch) => {
        // One call, one field at a time — so each change gets its own
        // History line rather than one line standing for several.
        let latest = tasks.findById(taskId)
        if (patch.status !== undefined) {
          latest = tasks.apply(taskId, { field: 'status', value: patch.status }, actor).task
        }
        if (patch.priority !== undefined) {
          latest = tasks.apply(taskId, { field: 'priority', value: patch.priority }, actor).task
        }
        if (patch.assignee !== undefined) {
          latest = tasks.apply(taskId, { field: 'assignee', value: patch.assignee }, actor).task
        }
        if (patch.addLabel !== undefined) {
          latest = tasks.apply(taskId, { field: 'addLabel', value: patch.addLabel }, actor).task
        }
        if (patch.removeLabel !== undefined) {
          latest = tasks.apply(
            taskId,
            { field: 'removeLabel', value: patch.removeLabel },
            actor,
          ).task
        }
        if (!latest) throw new Error(`unknown task "${taskId}"`)
        return latest
      },
      comment: (taskId, text) => {
        tasks.comment(taskId, { author: agent.name, tone: 'agent', text })
      },
    }
  }

  /** Only the skills this agent has enabled are exposed to its runner. */
  private skillPathsFor(agent: Agent): string[] {
    const enabled = new Set(agent.skills)
    return this.skills
      .findAll()
      .filter((skill) => enabled.has(skill.name))
      .map((skill) => resolve(skill.path))
  }

  /**
   * The servers this agent's `mcp_servers` names, resolved to launch specs.
   *
   * agent.toml is the only thing that decides this; mcp.json just says how to
   * start each server. A name with no entry there is a misconfiguration that
   * would otherwise vanish silently, so it is reported.
   */
  private mcpServersFor(agent: Agent): Record<string, McpLaunchSpec> {
    const configured = new Map(this.mcp.findAll().map((server) => [server.name, server]))

    const resolved: [string, McpLaunchSpec][] = []
    for (const name of agent.mcpServers) {
      // Built-ins run in-process; there is no command to launch.
      if (isBuiltinMcpServer(name)) continue

      const server = configured.get(name)
      if (!server) {
        process.stderr.write(
          `[mcp] agent "${agent.id}" enables "${name}", which is not in mcp.json\n`,
        )
        continue
      }
      const [command = '', ...args] = server.command.split(/\s+/)
      resolved.push([name, { command, args, env: server.env }])
    }

    return Object.fromEntries(resolved)
  }
}

/** Exported for tests that need a deterministic id. */
export function newSessionId(): string {
  return randomUUID()
}
