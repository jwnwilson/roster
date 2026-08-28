import type { ModelInfo, Question, RunnerId, RunnerStatus } from '../../../shared/types'

/**
 * A normalised event from any agent CLI. Each adapter translates its own
 * stream into this shape so nothing above the runner layer knows which CLI
 * produced it.
 */
export type RunnerEvent =
  /** A chunk of assistant prose. */
  | { kind: 'text'; delta: string }
  /**
   * The agent decided to call a tool. `args` is the one line the collapsed
   * row shows; `input` is everything it was called with, for the expanded
   * panel — a question's options only exist there.
   */
  | { kind: 'tool'; id: string; name: string; args: string; input?: string }
  /** That tool finished. */
  | { kind: 'result'; id: string; output: string; isError: boolean }
  /**
   * The CLI is blocked waiting for the user to allow or deny an action —
   * or, when `questions` is present, to answer rather than allow.
   */
  | {
      kind: 'approval'
      id: string
      toolName: string
      command: string
      questions?: Question[]
    }
  /** Running totals, not deltas. */
  | {
      kind: 'usage'
      inputTokens: number
      outputTokens: number
      /**
       * Every token the turn consumed, cache included. Each normalizer works
       * this out itself: Claude reports cache tokens *alongside* input, while
       * Codex reports them as a subset *of* input, so there is no summing rule
       * that is right for both.
       */
      totalTokens: number
      costUsd: number
    }
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
  /**
   * MCP servers Roster runs itself rather than launching — handoff, and the
   * task board when the agent has it enabled. Keyed by the name the agent
   * sees in its tool namespace. Only runners that support in-process MCP
   * receive these.
   */
  inProcessMcpServers?: Record<string, unknown>
  /**
   * Research and propose, do not act. The runner refuses edits for the whole
   * turn and the agent presents a plan instead, which arrives as an approval.
   */
  planMode?: boolean
  /** Resume the CLI's own session rather than starting fresh. */
  resumeFrom?: string
  /** Resume, but branch into a new session — the handoff primitive. */
  fork?: boolean
  signal: AbortSignal
}

export interface McpLaunchSpec {
  command: string
  args: string[]
  /** Merged over the inherited environment when the server starts. */
  env: Record<string, string>
}

/** How Roster answers a pending approval. */
export interface ApprovalDecision {
  approved: boolean
  reason?: string
  /**
   * What the user chose, keyed by question text — the shape the question
   * tool reads back. Allowing the call with these filled in is how an answer
   * reaches the agent; allowing without them is how "they did not answer" does.
   */
  answers?: Record<string, string>
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
