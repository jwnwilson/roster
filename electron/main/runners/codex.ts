import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ModelInfo, RunnerStatus } from '../../../shared/types'
import { detectAllRunners } from '../auth/probes'
import { gitMetadata } from '../sessions/repo'
import { worktreesDir } from '../store/paths'
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
 * Codex enforces permissions through its own sandbox rather than a callback.
 * Roster extends Codex's workspace profile with the two narrow exceptions Git
 * needs to manage worktrees: the repository metadata and Roster's worktree
 * directory. Roster's approval banner is not wired to this runner; see
 * respondToApproval.
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
    const permissions = codexPermissionOverrides(options.cwd).flatMap((override) => [
      '--config',
      override,
    ])

    // `exec resume` has its own option set. Its working directory is inherited
    // from the stored session, so it rejects the base `exec` command's `-C`.
    // Config overrides are accepted by both commands and are repeated so a
    // resumed agent retains the same least-privilege Git access.
    const args =
      options.resumeFrom !== undefined && options.resumeFrom !== ''
        ? [
            'exec',
            'resume',
            '--json',
            '--skip-git-repo-check',
            '--ignore-user-config',
            '--strict-config',
            ...permissions,
            '--model',
            options.model,
            options.resumeFrom,
          ]
        : [
            'exec',
            '--json',
            '--skip-git-repo-check',
            '--ignore-user-config',
            '--strict-config',
            ...permissions,
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

const WORKTREE_PERMISSION_PROFILE = 'roster-worktree'

/**
 * Build command-line TOML overrides for the smallest useful Codex sandbox.
 *
 * `:workspace` keeps Codex's normal protections, including read-only `.git`
 * and `.codex` directories. The exact Git directories are then made writable,
 * along with only the directory where Roster tells agents to create worktrees.
 */
export function codexPermissionOverrides(
  cwd: string,
  worktreeRoot = worktreesDir(),
): string[] {
  const metadata = gitMetadata(cwd)
  const writablePaths = metadata
    ? [...new Set([metadata.gitDir, metadata.commonDir, worktreeRoot])]
    : [worktreeRoot]

  return [
    `default_permissions=${tomlString(WORKTREE_PERMISSION_PROFILE)}`,
    `permissions.${WORKTREE_PERMISSION_PROFILE}.extends=${tomlString(':workspace')}`,
    `permissions.${WORKTREE_PERMISSION_PROFILE}.filesystem={${writablePaths
      .map((path) => `${tomlString(path)}="write"`)
      .join(',')}}`,
  ]
}

/** JSON string syntax is also valid TOML basic-string syntax. */
function tomlString(value: string): string {
  return JSON.stringify(value)
}

/**
 * Codex has no system-prompt flag on `exec`, so an agent's house rules are
 * prepended to the prompt itself.
 */
export function composePrompt(prompt: string, systemPrompt: string): string {
  if (systemPrompt.trim() === '') return prompt
  return `${systemPrompt.trim()}\n\n---\n\n${prompt}`
}
