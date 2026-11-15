import type { Question } from '../../../../shared/types'
import type { ApprovalDecision } from '../types'

/**
 * Signing a provider in from inside a turn.
 *
 * A model whose provider has no credentials can still be chosen. The first
 * turn on it asks — as an approval, like any other action — to run the sign-in
 * for that provider. Pi's own login flow then runs in process: a browser opens
 * for account sign-in, and anything it needs typed (an API key, a pasted code)
 * is asked as a question in the same approval banner.
 */

/** What Roster needs to know about a provider's ways in. */
export interface ProviderAuthInfo {
  id: string
  name: string
  /** e.g. "OpenAI (ChatGPT subscription)", when the provider has account sign-in. */
  oauth?: string
  /** e.g. "OpenAI API key", when a key can be entered. */
  apiKey?: string
}

export type SignInMethod = 'oauth' | 'api_key'

export interface SignInMethodOption {
  method: SignInMethod
  label: string
  description: string
}

/** The ways this provider can be signed in to, account sign-in first. */
export function signInMethods(provider: ProviderAuthInfo): SignInMethodOption[] {
  return [
    ...(provider.oauth !== undefined
      ? [{ method: 'oauth' as const, label: 'Sign in with account', description: `${provider.oauth} — opens your browser` }]
      : []),
    ...(provider.apiKey !== undefined
      ? [{ method: 'api_key' as const, label: 'Enter an API key', description: provider.apiKey }]
      : []),
  ]
}

/** The terminal command the approval names, so it reads as what it does. */
export function signInCommand(provider: ProviderAuthInfo, method?: SignInMethod): string {
  return `pi auth login ${provider.id}${method === 'api_key' ? ' --api-key' : ''}`
}

export const SIGN_IN_TOOL = 'sign_in'

/** One approval as the runner raises it. */
export interface SignInApproval {
  toolName: string
  command: string
  questions?: Question[]
  /** The question wants a password or API key: type it, do not show it back. */
  secret?: boolean
}

/**
 * Asks once whether to sign in, and how.
 *
 * With one way in this is a plain approval; with several, the approval is a
 * question whose answer is the method — so permission and choice are one act.
 * Resolves to the chosen method, or null when the user said no.
 */
export async function askToSignIn(
  provider: ProviderAuthInfo,
  ask: (approval: SignInApproval) => Promise<ApprovalDecision>,
  again = false,
): Promise<SignInMethod | null> {
  const methods = signInMethods(provider)
  if (methods.length === 0) return null

  if (methods.length === 1) {
    const only = methods[0]!
    const decision = await ask({ toolName: SIGN_IN_TOOL, command: signInCommand(provider, only.method) })
    return decision.approved ? only.method : null
  }

  // Asked again after the provider refused what was saved: say so, or the
  // same question twice reads as Roster forgetting it was answered.
  const question = again
    ? `${provider.name} rejected the saved sign-in. Sign in again?`
    : `Sign in to ${provider.name} to use this model?`
  const decision = await ask({
    toolName: SIGN_IN_TOOL,
    command: signInCommand(provider),
    questions: [
      {
        question,
        header: 'Sign in',
        multiSelect: false,
        options: methods.map(({ label, description }) => ({ label, description })),
      },
    ],
  })
  if (!decision.approved) return null

  const answer = decision.answers?.[question]
  return methods.find((option) => option.label === answer)?.method ?? methods[0]!.method
}

/** The prompts Pi's login flows make, as far as Roster needs them. */
export type LoginPrompt =
  | { type: 'text' | 'secret' | 'manual_code'; message: string; placeholder?: string; signal?: AbortSignal }
  | {
      type: 'select'
      message: string
      options: readonly { id: string; label: string; description?: string }[]
      signal?: AbortSignal
    }

export type LoginEvent =
  | { type: 'info'; message: string }
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'device_code'; userCode: string; verificationUri: string }
  | { type: 'progress'; message: string }

/** Cancels a typed answer: the option the free-text questions offer instead. */
const CANCEL = 'Cancel'

/**
 * Pi's login interaction, answered through Roster's approval banner.
 *
 * - A URL to visit opens in the browser.
 * - A device code opens its page and is shown as an approval to read.
 * - A choice is a question with those options.
 * - Text, a secret or a pasted code is a question answered by typing
 *   (the banner's free-text "Other"), with Cancel as the only option.
 *
 * A prompt that carries its own signal — a pasted code raced against the
 * browser callback — withdraws its question when the callback wins.
 */
export function loginInteraction(deps: {
  signal: AbortSignal
  openUrl: (url: string) => void
  ask: (approval: SignInApproval, signal?: AbortSignal) => Promise<ApprovalDecision>
  /** Shows something to read, without waiting for an answer. */
  tell: (approval: SignInApproval) => void
}) {
  return {
    signal: deps.signal,

    notify(event: LoginEvent): void {
      if (event.type === 'auth_url') {
        deps.openUrl(event.url)
      } else if (event.type === 'device_code') {
        deps.openUrl(event.verificationUri)
        deps.tell({
          toolName: SIGN_IN_TOOL,
          command: `Enter code ${event.userCode} at ${event.verificationUri}`,
        })
      }
    },

    async prompt(prompt: LoginPrompt): Promise<string> {
      const question = prompt.message
      const options =
        prompt.type === 'select'
          ? prompt.options.map((option) => ({ label: option.label, description: option.description ?? '' }))
          : [{ label: CANCEL, description: 'Type the answer in "Other" instead' }]

      const decision = await deps.ask(
        {
          toolName: SIGN_IN_TOOL,
          command: question,
          questions: [{ question, header: 'Sign in', multiSelect: false, options }],
          ...(prompt.type === 'secret' ? { secret: true } : {}),
        },
        prompt.signal,
      )

      const answer = decision.answers?.[question]?.trim() ?? ''
      if (!decision.approved || answer === '' || answer === CANCEL) {
        throw new Error('sign-in was cancelled')
      }

      if (prompt.type === 'select') {
        const chosen = prompt.options.find((option) => option.label === answer)
        if (!chosen) throw new Error(`"${answer}" is not one of the choices`)
        return chosen.id
      }
      return answer
    },
  }
}

export type LoginInteraction = ReturnType<typeof loginInteraction>

/**
 * A sign-in failure in words that say what to do next.
 *
 * Pi passes the provider's raw response through, which is accurate and opaque
 * — `{"error":"invalid_grant"}` says nothing about cookies or connected apps.
 * Known shapes get an explanation; anything else is shown as it came.
 */
export function explainSignInFailure(provider: ProviderAuthInfo, message: string): string {
  const lead = `Could not sign in to ${provider.name}`

  if (/invalid_grant/i.test(message)) {
    return [
      `${lead}: ${provider.name} accepted your login in the browser but refused to issue a token (invalid_grant).`,
      'This is usually stale sign-in cookies in the browser. Try again in a private window, or clear cookies for auth.openai.com,',
      ...(provider.id === 'openai'
        ? [
            'and remove old "Pi" or "Roster" entries under ChatGPT → Settings → Connected apps.',
            'OpenAI Codex models (openai-codex/…) sign in a different way and may work while this does not.',
          ]
        : ['then send your message again to retry.']),
    ].join(' ')
  }
  if (/3p_delegated_access_policy_denied|hasn't enabled access/i.test(message)) {
    return `${lead}: your ChatGPT workspace does not allow this app. A workspace admin has to enable it — or use OpenAI Codex models (openai-codex/…), which business workspaces usually allow.`
  }
  if (/port \d+ is in use|EADDRINUSE/i.test(message)) {
    return `${lead}: another sign-in is still waiting for its browser callback (a \`pi\` CLI login, the Codex CLI, or another Roster session). Finish or cancel that one, then send your message again.`
  }
  if (/cancel/i.test(message)) {
    return `${lead}: sign-in was cancelled. Send your message again to retry.`
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
    return `${lead}: could not reach ${provider.name}. Check your connection and send your message again.`
  }
  return `${lead}: ${message}`
}

/** A model the account cannot use, said plainly. */
export function explainUnavailableModel(model: string, message: string): string {
  const why = message.replace(/^.*?error:\s*/i, '').trim().replace(/\.$/, '')
  return `${model} is not available on your account (${why}). Roster has greyed it out in the model list — pick another model for this agent.`
}
