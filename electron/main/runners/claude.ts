import { randomUUID } from 'node:crypto'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { ModelInfo, RunnerStatus } from '../../../shared/types'
import { detectAllRunners } from '../auth/probes'
import { normalizeClaudeMessage } from './normalizeClaude'
import type { ApprovalDecision, Runner, RunnerEvent, StartOptions } from './types'

/**
 * Models offered for this runner.
 *
 * The Agent SDK exposes no priced catalogue, so this table is data Roster
 * owns and must keep current. Prices are input/output per million tokens.
 */
const MODELS: ModelInfo[] = [
  { id: 'claude-opus-5', price: '$5 / $25' },
  { id: 'claude-sonnet-5', price: '$3 / $15' },
  { id: 'claude-haiku-4-5', price: '$1 / $5' },
]

/** Roster's own MCP tools, namespaced as the SDK exposes them. */
const ROSTER_TOOLS = ['mcp__roster__list_agents', 'mcp__roster__open_session']

interface PendingApproval {
  resolve(decision: ApprovalDecision): void
}

/**
 * Backs an agent with Claude Code via the official Agent SDK, running on
 * whatever account the user has already logged in with.
 */
export class ClaudeRunner implements Runner {
  readonly id = 'claude'

  /** Approvals this runner is blocked on, keyed by the id given to the UI. */
  private pending = new Map<string, PendingApproval>()

  async detect(): Promise<RunnerStatus> {
    const statuses = await detectAllRunners()
    return (
      statuses.get('claude') ?? {
        id: 'claude',
        provider: 'Anthropic',
        installed: false,
        ready: false,
        auth: 'none',
        detail: 'claude is not installed',
      }
    )
  }

  async models(): Promise<ModelInfo[]> {
    return MODELS
  }

  async *run(prompt: string, options: StartOptions): AsyncIterable<RunnerEvent> {
    // Imported lazily so the module graph — and the tests that only touch the
    // normalizer — never pull in the SDK runtime.
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const response = query({
      prompt,
      options: {
        cwd: options.cwd,
        model: options.model,
        abortController: toController(options.signal),
        canUseTool: (toolName, input) => this.requestApproval(toolName, input),
        // Roster owns permissions, not the user's global Claude Code config,
        // so its own allowlist is the one that applies.
        settingSources: [],
        permissionMode: 'default',
        // Roster's own tools are affordances of the app, not actions on the
        // user's machine — asking permission to look at the roster or open a
        // session would be friction with nothing behind it.
        allowedTools: ROSTER_TOOLS,
        ...(options.systemPrompt !== ''
          ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: options.systemPrompt } }
          : {}),
        ...(options.skillPaths.length > 0 ? { additionalDirectories: options.skillPaths } : {}),
        ...(Object.keys(options.mcpServers).length > 0 || options.rosterTools
          ? {
              mcpServers: {
                ...toMcpConfig(options.mcpServers),
                ...(options.rosterTools
                  ? { roster: options.rosterTools as McpServerConfig }
                  : {}),
              },
            }
          : {}),
        ...(options.resumeFrom !== undefined ? { resume: options.resumeFrom } : {}),
        ...(options.fork === true ? { forkSession: true } : {}),
      },
    })

    try {
      for await (const message of response) {
        for (const event of normalizeClaudeMessage(message)) yield event
      }
    } catch (cause) {
      // A crashed CLI must still end the turn, or the UI waits forever.
      yield { kind: 'error', message: describe(cause) }
      yield { kind: 'done', runnerSessionId: options.resumeFrom ?? '' }
    } finally {
      this.failPendingApprovals()
    }
  }

  respondToApproval(approvalId: string, decision: ApprovalDecision): void {
    const pending = this.pending.get(approvalId)
    if (!pending) return

    this.pending.delete(approvalId)
    pending.resolve(decision)
  }

  /**
   * Called by the SDK when the CLI needs permission. The returned promise is
   * what blocks the agent, so the approval is a real gate rather than a
   * notification — the tool does not run until the user answers.
   */
  private requestApproval(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }> {
    const id = randomUUID()

    return new Promise((resolve) => {
      this.pending.set(id, {
        resolve: (decision) =>
          resolve(
            decision.approved
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: decision.reason ?? 'Denied by the user' },
          ),
      })

      this.onApprovalNeeded?.({
        kind: 'approval',
        id,
        toolName,
        command: describeCommand(toolName, input),
      })
    })
  }

  /** Set by the session manager so approvals reach the UI mid-turn. */
  onApprovalNeeded?: (event: Extract<RunnerEvent, { kind: 'approval' }>) => void

  private failPendingApprovals(): void {
    for (const [, pending] of this.pending) {
      pending.resolve({ approved: false, reason: 'The run ended before you answered' })
    }
    this.pending.clear()
  }
}

/** The SDK wants an AbortController; Roster's session layer owns the signal. */
function toController(signal: AbortSignal): AbortController {
  const controller = new AbortController()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', () => controller.abort(), { once: true })
  return controller
}

function toMcpConfig(servers: StartOptions['mcpServers']): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, spec]): [string, McpServerConfig] => [
      name,
      { type: 'stdio', command: spec.command, args: spec.args },
    ]),
  )
}

/** The approval banner names the exact command, so prefer the real one. */
export function describeCommand(toolName: string, input: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'path', 'url']) {
    const value = input[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return toolName
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
