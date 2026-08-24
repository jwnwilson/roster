import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AuthKind, ProviderName, RunnerId, RunnerStatus } from '../../../shared/types'

/**
 * Every system probe is injected so detection is testable without touching
 * the real PATH, filesystem, or keychain.
 */
export interface DetectDeps {
  /** Absolute path to the binary, or null when it is not on PATH. */
  which(command: string): Promise<string | null>
  version(command: string): Promise<string | null>
  readFile(path: string): Promise<string | null>
  keychainHas(service: string): Promise<boolean>
  env: Record<string, string | undefined>
}

interface RunnerSpec {
  command: string
  provider: ProviderName
  loginHint: string
  apiKeyEnv: string[]
  resolveAuth(deps: DetectDeps): Promise<AuthKind>
}

const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'

const SPECS: Record<string, RunnerSpec> = {
  claude: {
    command: 'claude',
    provider: 'Anthropic',
    loginHint: 'run `claude auth login`',
    apiKeyEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
    async resolveAuth(deps) {
      // macOS keeps the subscription token in the keychain; other platforms
      // fall back to a credentials file in the Claude home.
      if (await deps.keychainHas(CLAUDE_KEYCHAIN_SERVICE)) return 'subscription'
      const file = await deps.readFile(join(homedir(), '.claude', '.credentials.json'))
      return file !== null ? 'subscription' : 'none'
    },
  },
  codex: {
    command: 'codex',
    provider: 'OpenAI',
    loginHint: 'run `codex login`',
    apiKeyEnv: ['OPENAI_API_KEY'],
    async resolveAuth(deps) {
      const raw = await deps.readFile(join(homedir(), '.codex', 'auth.json'))
      if (raw === null) return 'none'
      try {
        const parsed = JSON.parse(raw) as { auth_mode?: string }
        if (parsed.auth_mode === 'chatgpt') return 'subscription'
        if (parsed.auth_mode === 'apikey') return 'api-key'
        return 'none'
      } catch {
        // A corrupt auth.json means logged out, not a crash on startup.
        return 'none'
      }
    },
  },
  gemini: {
    command: 'gemini',
    provider: 'Google',
    loginHint: 'run `gemini auth login`',
    apiKeyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    async resolveAuth(deps) {
      const file = await deps.readFile(join(homedir(), '.gemini', 'oauth_creds.json'))
      return file !== null ? 'subscription' : 'none'
    },
  },
}

function hasApiKey(spec: RunnerSpec, env: DetectDeps['env']): boolean {
  return spec.apiKeyEnv.some((name) => {
    const value = env[name]
    return typeof value === 'string' && value !== ''
  })
}

/**
 * @param command The binary to look for, when it differs from the runner id.
 *   A custom runner is named by the user — "ollama-codex" might run `codex` —
 *   so probing the id would report a working setup as missing.
 */
export async function detectRunner(
  id: RunnerId,
  deps: DetectDeps,
  command: string = id,
): Promise<RunnerStatus> {
  const spec = SPECS[id]

  // A runner Roster does not know about: report presence only. We cannot know
  // how someone else's CLI authenticates, so we never claim it is logged in.
  if (!spec) {
    const path = await deps.which(command)
    return {
      id,
      provider: 'Custom',
      installed: path !== null,
      ready: path !== null,
      auth: 'none',
      ...(path !== null ? { path } : {}),
      ...(path === null ? { detail: `${command} is not installed` } : {}),
    }
  }

  const path = await deps.which(spec.command)
  if (path === null) {
    return {
      id,
      provider: spec.provider,
      installed: false,
      ready: false,
      auth: 'none',
      detail: `${spec.command} is not installed`,
    }
  }

  const version = await deps.version(spec.command)
  // An explicit key in the environment takes precedence over a stored login,
  // matching how the CLIs themselves resolve credentials.
  const auth: AuthKind = hasApiKey(spec, deps.env) ? 'api-key' : await spec.resolveAuth(deps)

  return {
    id,
    provider: spec.provider,
    installed: true,
    ready: auth !== 'none',
    auth,
    path,
    ...(version !== null ? { version } : {}),
    ...(auth === 'none' ? { detail: `not signed in — ${spec.loginHint}` } : {}),
  }
}

export function builtinRunnerIds(): string[] {
  return Object.keys(SPECS)
}
