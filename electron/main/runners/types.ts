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
      /**
       * The whole plan, when the tool was ExitPlanMode.
       *
       * `command` carries only its heading, which is all the banner shows.
       * Roster keeps the plan itself, so it has to travel with the approval
       * rather than being dug back out of the transcript.
       */
      plan?: string
    }
  /** Running totals, not deltas. */
  | {
      kind: 'usage'
      inputTokens: number
      cachedInputTokens?: number
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

/**
 * A skill an agent has turned on.
 *
 * Identity only. What a runner does with it differs — Claude enables it by
 * name through its own skill mechanism, Codex has no such mechanism and has to
 * be given the text — so the runner that needs the SKILL.md reads it, rather
 * than every turn paying for a file only one of them will look at.
 */
export interface EnabledSkill {
  /** The name the library, the agent's `skills` list and the runner all use. */
  name: string
  /** Absolute path to the skill folder. */
  path: string
}

export interface StartOptions {
  cwd: string
  /**
   * The project's other repositories, which this turn may read.
   *
   * Optional, and honoured differently by each runner — deliberately, because
   * what each one can actually promise differs:
   *
   * - **Claude** grants them through `additionalDirectories`, which is read
   *   *and write*: the SDK has no read-only mode.
   * - **Codex** needs nothing. Its `:workspace` profile already reads broadly
   *   and writes only inside the cwd, so the secondaries are readable and not
   *   writable without Roster listing them. Adding them to the writable set
   *   would grant write to a secondary's git metadata while its working tree
   *   stayed read-only, which is the worst of both.
   * - **Custom** ignores them. A custom runner is an argv template Roster
   *   does not understand, and there is no honest way to tell it about a
   *   second directory.
   */
  additionalRoots?: readonly string[]
  model: string
  systemPrompt: string
  /** The skills enabled for this agent, in the order the agent names them. */
  skills: EnabledSkill[]
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
