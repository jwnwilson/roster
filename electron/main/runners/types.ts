import type { ModelInfo, RunnerId, RunnerStatus } from '../../../shared/types'

/**
 * A normalised event from any agent CLI. Each adapter translates its own
 * stream into this shape so nothing above the runner layer knows which CLI
 * produced it.
 */
export type RunnerEvent =
  /** A chunk of assistant prose. */
  | { kind: 'text'; delta: string }
  /** The agent decided to call a tool. */
  | { kind: 'tool'; id: string; name: string; args: string }
  /** That tool finished. */
  | { kind: 'result'; id: string; output: string; isError: boolean }
  /** The CLI is blocked waiting for the user to allow or deny an action. */
  | { kind: 'approval'; id: string; toolName: string; command: string }
  /** Running totals, not deltas. */
  | { kind: 'usage'; inputTokens: number; outputTokens: number; costUsd: number }
  /**
   * The CLI's own session id, for resume and fork. Codex reports it when the
   * thread opens; Claude reports it on the result, so `done` carries it too.
   */
  | { kind: 'session'; runnerSessionId: string }
  /** The turn finished. */
  | { kind: 'done'; runnerSessionId: string }
  | { kind: 'error'; message: string }

export interface StartOptions {
  cwd: string
  model: string
  systemPrompt: string
  /** Absolute paths to skill folders enabled for this agent. */
  skillPaths: string[]
  /** MCP servers enabled for this agent, keyed by name. */
  mcpServers: Record<string, McpLaunchSpec>
  /** Resume the CLI's own session rather than starting fresh. */
  resumeFrom?: string
  /** Resume, but branch into a new session — the handoff primitive. */
  fork?: boolean
  signal: AbortSignal
}

export interface McpLaunchSpec {
  command: string
  args: string[]
}

/** How Roster answers a pending approval. */
export interface ApprovalDecision {
  approved: boolean
  reason?: string
}

export interface Runner {
  readonly id: RunnerId
  detect(): Promise<RunnerStatus>
  models(): Promise<ModelInfo[]>
  /** Runs one turn, yielding events until the turn ends. */
  run(prompt: string, options: StartOptions): AsyncIterable<RunnerEvent>
  /** Answers an approval this runner is blocked on. */
  respondToApproval(approvalId: string, decision: ApprovalDecision): void
}
