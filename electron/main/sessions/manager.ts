import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { Agent, Approval, Message, Session, Usage } from '../../../shared/types'
import type { AgentStore } from '../store/agents'
import type { McpStore } from '../store/mcp'
import type { SessionStore } from '../store/sessions'
import type { SkillStore } from '../store/skills'
import type { UsageStore } from '../store/usage'
import type { TaskStore } from '../store/tasks'
import type { ProjectStore } from '../store/projects'
import { getRunner } from '../runners/registry'
import type { ApprovalDecision, McpLaunchSpec, RunnerEvent } from '../runners/types'
import { ClaudeRunner } from '../runners/claude'
import { createRosterMcpServer, type TaskTools } from '../runners/handoffTool'
import { describeActivity, THINKING } from './activity'

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

  async send(sessionId: string, prompt: string): Promise<void> {
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

    const run: ActiveRun = {
      abort: new AbortController(),
      toolMessages: new Map(),
      toolStartedAt: new Map(),
      approvals: new Map(),
      runnerId: agent.runner,
      pendingText: '',
      flushTimer: null,
    }
    this.active.set(sessionId, run)

    this.setStatus(sessionId, 'running')
    this.emit({ type: 'streaming', sessionId, active: true })
    this.emit({ type: 'activity', sessionId, text: THINKING })

    // Only the Claude runner supports in-process MCP, so only it can be
    // given the roster tools; other runners simply cannot hand off yet.
    let rosterTools: unknown
    if (runner instanceof ClaudeRunner) {
      runner.onApprovalNeeded = (event) => this.raiseApproval(sessionId, run, event)
      rosterTools = await createRosterMcpServer(
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
        this.taskToolsFor(agent),
      )
    }

    try {
      const stream = runner.run(prompt, {
        cwd: agent.cwd,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        skillPaths: this.skillPathsFor(agent),
        mcpServers: this.mcpServersFor(agent),
        signal: run.abort.signal,
        ...(rosterTools ? { rosterTools } : {}),
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
    }
  }

  cancel(sessionId: string): void {
    this.active.get(sessionId)?.abort.abort()
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
        const message = this.record(sessionId, {
          sessionId,
          kind: 'tool',
          tool: event.name,
          args: event.args,
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
    const approval: Approval = {
      id: event.id,
      sessionId,
      toolName: event.toolName,
      command: event.command,
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
   * person's drag would be. Absent when no task store was supplied, which is
   * what keeps the manager usable in tests that do not care about tasks.
   */
  private taskToolsFor(agent: Agent): TaskTools | undefined {
    const board = this.board
    if (!board) return undefined
    const { tasks, projects } = board

    const actor = { name: agent.name, tone: 'agent' as const }

    return {
      list: () => tasks.findAll(),
      find: (taskId) => tasks.findById(taskId),
      comments: (taskId) => tasks.comments(taskId),
      projectName: (projectId) => projects.findById(projectId)?.name ?? null,
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
