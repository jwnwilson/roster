import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ModelInfo, RunnerStatus } from '../../../shared/types'
import { detectAllRunners } from '../auth/probes'
import { normalizeCodexMessage } from './normalizeCodex'
import { streamJsonLines } from './subprocess'
import type { ApprovalDecision, Runner, RunnerEvent, StartOptions } from './types'

/**
 * Fallback list, used only when the CLI's own cache cannot be read. Codex
 * publishes no prices, so the price column stays empty rather than invented.
 */
const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gpt-5.6-terra', price: '' },
  { id: 'gpt-5.6-luna', price: '' },
  { id: 'gpt-5.5', price: '' },
  { id: 'gpt-5.4-mini', price: '' },
]

/** Models Codex will not accept as a session model. */
const EXCLUDED_SLUGS = new Set(['codex-auto-review'])

/**
 * Backs an agent with Codex CLI, running on whatever account the user has
 * already logged in with.
 *
 * Codex enforces permissions through its own sandbox rather than a callback,
 * so Roster runs it in `workspace-write` — writes inside the working
 * directory are allowed, anything wider is refused by Codex itself. Roster's
 * approval banner is not wired to this runner; see respondToApproval.
 */
export class CodexRunner implements Runner {
  readonly id = 'codex'

  async detect(): Promise<RunnerStatus> {
    const statuses = await detectAllRunners()
    return (
      statuses.get('codex') ?? {
        id: 'codex',
        provider: 'OpenAI',
        installed: false,
        ready: false,
        auth: 'none',
        detail: 'codex is not installed',
      }
    )
  }

  /**
   * Read from the CLI's own model cache, so the list is whatever the user's
   * Codex actually offers rather than a table Roster has to keep current.
   */
  async models(): Promise<ModelInfo[]> {
    try {
      const raw = await readFile(join(homedir(), '.codex', 'models_cache.json'), 'utf8')
      const parsed = JSON.parse(raw) as { models?: { slug?: unknown }[] }

      const models = (parsed.models ?? [])
        .map((entry) => entry.slug)
        .filter((slug): slug is string => typeof slug === 'string' && !EXCLUDED_SLUGS.has(slug))
        .map((slug) => ({ id: slug, price: '' }))

      return models.length > 0 ? models : FALLBACK_MODELS
    } catch {
      return FALLBACK_MODELS
    }
  }

  /** Resolved once at detection; PATH is not reliable inside a launched app. */
  private binary = 'codex'

  async warmUp(): Promise<void> {
    const status = await this.detect()
    if (status.path) this.binary = status.path
  }

  run(prompt: string, options: StartOptions): AsyncIterable<RunnerEvent> {
    // `exec resume` has its own option set. In particular, its working
    // directory and sandbox are inherited from the stored session, so it
    // rejects the base `exec` command's `-C` and `--sandbox` options.
    const args =
      options.resumeFrom !== undefined && options.resumeFrom !== ''
        ? [
            'exec',
            'resume',
            '--json',
            '--skip-git-repo-check',
            '--model',
            options.model,
            options.resumeFrom,
          ]
        : [
            'exec',
            '--json',
            '--skip-git-repo-check',
            '--sandbox',
            'workspace-write',
            '-C',
            options.cwd,
            '--model',
            options.model,
          ]

    args.push(composePrompt(prompt, options.systemPrompt))

    return streamJsonLines(
      { command: this.binary, args, cwd: options.cwd, signal: options.signal },
      normalizeCodexMessage,
    )
  }

  respondToApproval(): void {
    // Codex gates through its sandbox policy, not a callback, so there is
    // nothing for Roster to release. Left explicit rather than silently
    // absent so the asymmetry with the Claude runner is visible.
  }
}

/**
 * Codex has no system-prompt flag on `exec`, so an agent's house rules are
 * prepended to the prompt itself.
 */
export function composePrompt(prompt: string, systemPrompt: string): string {
  if (systemPrompt.trim() === '') return prompt
  return `${systemPrompt.trim()}\n\n---\n\n${prompt}`
}
