import type { CustomRunnerSpec, ModelInfo, RunnerStatus } from '../../../shared/types'
import { detectAllRunners } from '../auth/probes'
import { normalizeCodexMessage } from './normalizeCodex'
import { normalizeClaudeMessage } from './normalizeClaude'
import { streamJsonLines } from './subprocess'
import type { ApprovalDecision, Runner, RunnerEvent, StartOptions } from './types'

/**
 * Which known stream shape a user's own CLI speaks. Declared in agent.toml
 * so bringing your own tool needs no code.
 */
export type CustomDialect = 'claude' | 'codex'

const NORMALIZERS: Record<CustomDialect, (line: unknown) => RunnerEvent[]> = {
  claude: normalizeClaudeMessage,
  codex: normalizeCodexMessage,
}

/**
 * Runs any user-supplied CLI that emits JSONL.
 *
 * Roster cannot know how someone else's tool authenticates, so detection
 * reports presence on PATH only and never claims it is signed in.
 */
export class CustomRunner implements Runner {
  constructor(
    readonly id: string,
    private readonly spec: CustomRunnerSpec,
    private readonly dialect: CustomDialect = 'claude',
  ) {}

  async detect(): Promise<RunnerStatus> {
    const statuses = await detectAllRunners([this.id])
    return (
      statuses.get(this.id) ?? {
        id: this.id,
        provider: 'Custom',
        installed: false,
        ready: false,
        auth: 'none',
        detail: `${this.spec.command} is not installed`,
      }
    )
  }

  private binary: string | null = null

  async warmUp(): Promise<void> {
    const status = await this.detect()
    if (status.path) this.binary = status.path
  }

  async models(): Promise<ModelInfo[]> {
    // A user's own CLI has no catalogue Roster can read; the model set in
    // agent.toml is passed through as the only option.
    return []
  }

  run(prompt: string, options: StartOptions): AsyncIterable<RunnerEvent> {
    const args = this.spec.args.map((arg) =>
      arg
        .replace('{prompt}', prompt)
        .replace('{model}', options.model)
        .replace('{cwd}', options.cwd)
        .replace('{system}', options.systemPrompt),
    )

    // A template with no {prompt} placeholder gets the prompt appended, so a
    // bare command like `mytool --json` still works.
    if (!this.spec.args.some((arg) => arg.includes('{prompt}'))) args.push(prompt)

    return streamJsonLines(
      { command: this.binary ?? this.spec.command, args, cwd: options.cwd, signal: options.signal },
      NORMALIZERS[this.dialect],
    )
  }

  respondToApproval(_approvalId: string, _decision: ApprovalDecision): void {
    // A user's CLI has no permission callback Roster can drive.
  }
}
