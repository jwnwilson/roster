import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { Agent, Approval, Message, Session, Usage } from '../../../shared/types'
import type { AgentStore } from '../store/agents'
import type { McpStore } from '../store/mcp'
import type { SessionStore } from '../store/sessions'
import type { SkillStore } from '../store/skills'
import { contextWindowFor, type UsageStore } from '../store/usage'
import { getRunner } from '../runners/registry'
import type { ApprovalDecision, McpLaunchSpec, RunnerEvent } from '../runners/types'
import { ClaudeRunner } from '../runners/claude'

/** Everything the manager emits so the renderer can follow a live turn. */
export type SessionEvent =
  | { type: 'message'; sessionId: string; message: Message }
  | { type: 'message-updated'; sessionId: string; message: Message }
  | { type: 'status'; sessionId: string; status: Session['status'] }
  | { type: 'usage'; sessionId: string; usage: Usage }
  | { type: 'approval'; sessionId: string; approval: Approval }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string }
  | { type: 'streaming'; sessionId: string; active: boolean }

interface ActiveRun {
  abort: AbortController
  /** Tool messages awaiting their result, keyed by the runner's tool id. */
  toolMessages: Map<string, Message>
  /** Approvals raised during this run. */
  approvals: Map<string, Approval>
  runnerId: string
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

  /** Opens a session on another agent — how one agent hands work to another. */
  handOff(input: {
    fromAgentId: string
    fromSessionId: string
    toAgentId: string
    title: string
  }): Session {
    const from = this.agents.findById(input.fromAgentId)
    const label = from ? `${from.name} · ${input.title}` : input.title

    return this.sessions.create({
      agentId: input.toAgentId,
      title: input.title,
      origin: 'agent',
      from: { agentId: input.fromAgentId, sessionId: input.fromSessionId, label },
    })
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
      approvals: new Map(),
      runnerId: agent.runner,
    }
    this.active.set(sessionId, run)

    this.setStatus(sessionId, 'running')
    this.emit({ type: 'streaming', sessionId, active: true })

    if (runner instanceof ClaudeRunner) {
      runner.onApprovalNeeded = (event) => this.raiseApproval(sessionId, run, event)
    }

    try {
      const stream = runner.run(prompt, {
        cwd: agent.cwd,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        skillPaths: this.skillPathsFor(agent),
        mcpServers: this.mcpServersFor(agent),
        signal: run.abort.signal,
        ...(session.runnerSessionId !== undefined ? { resumeFrom: session.runnerSessionId } : {}),
      })

      for await (const event of stream) this.handle(sessionId, run, event)
    } catch (cause) {
      this.failTurn(sessionId, cause instanceof Error ? cause.message : String(cause))
    } finally {
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
        this.appendAssistantText(sessionId, event.delta)
        return

      case 'tool': {
        const message = this.record(sessionId, {
          sessionId,
          kind: 'tool',
          tool: event.name,
          args: event.args,
          output: '',
          isError: false,
        })
        run.toolMessages.set(event.id, message)
        return
      }

      case 'result': {
        const message = run.toolMessages.get(event.id)
        if (!message || message.kind !== 'tool') return

        // The tool row was written when the call started; fill in its result.
        const updated: Message = { ...message, output: event.output, isError: event.isError }
        run.toolMessages.delete(event.id)
        this.emit({ type: 'message-updated', sessionId, message: updated })
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
          costUsd: event.costUsd,
          contextUsed: this.contextFraction(sessionId, event.inputTokens + event.outputTokens),
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
   * Assistant prose arrives as many small deltas. Rather than one message per
   * delta, they coalesce into the run's current assistant message.
   */
  private appendAssistantText(sessionId: string, delta: string): void {
    const agentName = this.agentNameFor(sessionId)
    const existing = this.sessions.messages(sessionId).at(-1)

    if (existing?.kind === 'text' && existing.role === 'assistant') {
      const updated: Message = { ...existing, text: existing.text + delta }
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
  private contextFraction(sessionId: string, tokens: number): number {
    const session = this.sessions.findById(sessionId)
    const agent = session ? this.agents.findById(session.agentId) : null
    const window = agent ? contextWindowFor(agent.model) : null

    // An unknown model reports nothing rather than a made-up bar.
    if (window === null || window === 0) return 0
    return Math.min(1, tokens / window)
  }

  usageFor(sessionId: string): Usage | null {
    return this.usage.forSession(sessionId)
  }

  private agentNameFor(sessionId: string): string {
    const session = this.sessions.findById(sessionId)
    if (!session) return 'agent'
    return this.agents.findById(session.agentId)?.name ?? 'agent'
  }

  /** Only the skills this agent has enabled are exposed to its runner. */
  private skillPathsFor(agent: Agent): string[] {
    const enabled = new Set(agent.skills)
    return this.skills
      .findAll()
      .filter((skill) => enabled.has(skill.name))
      .map((skill) => resolve(skill.path))
  }

  private mcpServersFor(agent: Agent): Record<string, McpLaunchSpec> {
    const enabled = new Set(agent.mcpServers)

    return Object.fromEntries(
      this.mcp
        .findAll()
        .filter((server) => enabled.has(server.name) && server.enabledFor.includes(agent.id))
        .map((server) => {
          const [command = '', ...args] = server.command.split(/\s+/)
          return [server.name, { command, args }]
        }),
    )
  }
}

/** Exported for tests that need a deterministic id. */
export function newSessionId(): string {
  return randomUUID()
}
