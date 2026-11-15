import { describe, expect, test, vi } from 'vitest'
import {
  askToSignIn,
  loginInteraction,
  signInCommand,
  signInMethods,
  SIGN_IN_TOOL,
  type ProviderAuthInfo,
} from '@main/runners/pi/signIn'
import { toModelInfo } from '@main/runners/pi/models'
import { isAuthFailure } from '@main/runners/pi/runner'

const OPENAI: ProviderAuthInfo = {
  id: 'openai',
  name: 'OpenAI',
  oauth: 'OpenAI (ChatGPT subscription)',
  apiKey: 'OpenAI API key',
}
const CODEX: ProviderAuthInfo = { id: 'openai-codex', name: 'OpenAI Codex', oauth: 'OpenAI (ChatGPT Plus/Pro)' }

describe('sign-in methods', () => {
  test('offers account sign-in before an API key', () => {
    expect(signInMethods(OPENAI).map((m) => m.method)).toEqual(['oauth', 'api_key'])
    expect(signInMethods({ id: 'x', name: 'X' })).toEqual([])
  })

  test('names the terminal command it stands for', () => {
    expect(signInCommand(CODEX, 'oauth')).toBe('pi auth login openai-codex')
    expect(signInCommand(OPENAI, 'api_key')).toBe('pi auth login openai --api-key')
  })
})

describe('askToSignIn', () => {
  test('asks a plain approval when there is one way in', async () => {
    const ask = vi.fn(async () => ({ approved: true }))
    await expect(askToSignIn(CODEX, ask)).resolves.toBe('oauth')
    expect(ask).toHaveBeenCalledWith({ toolName: SIGN_IN_TOOL, command: 'pi auth login openai-codex' })
  })

  test('asks which way when there are several, and honours the answer', async () => {
    const ask = vi.fn(async () => ({
      approved: true,
      answers: { 'Sign in to OpenAI to use this model?': 'Enter an API key' },
    }))
    await expect(askToSignIn(OPENAI, ask)).resolves.toBe('api_key')
    const [approval] = ask.mock.calls[0] as unknown as [{ questions: { options: unknown[] }[] }]
    expect(approval.questions[0]!.options).toHaveLength(2)
  })

  test('defaults to account sign-in when approved without a choice', async () => {
    await expect(askToSignIn(OPENAI, async () => ({ approved: true }))).resolves.toBe('oauth')
  })

  test('returns null when refused or impossible', async () => {
    await expect(askToSignIn(CODEX, async () => ({ approved: false }))).resolves.toBeNull()
    await expect(askToSignIn(OPENAI, async () => ({ approved: false }))).resolves.toBeNull()
    await expect(askToSignIn({ id: 'x', name: 'X' }, async () => ({ approved: true }))).resolves.toBeNull()
  })
})

describe('loginInteraction', () => {
  const setup = (answer: string | undefined, approved = true) => {
    const openUrl = vi.fn()
    const tell = vi.fn()
    const ask = vi.fn(async (approval: { questions?: { question: string }[] }) => ({
      approved,
      ...(answer !== undefined ? { answers: { [approval.questions![0]!.question]: answer } } : {}),
    }))
    const interaction = loginInteraction({ signal: new AbortController().signal, openUrl, ask, tell })
    return { interaction, openUrl, tell, ask }
  }

  test('opens auth pages in the browser and shows device codes', () => {
    const { interaction, openUrl, tell } = setup(undefined)
    interaction.notify({ type: 'auth_url', url: 'https://auth.example/1' })
    interaction.notify({ type: 'device_code', userCode: 'ABCD', verificationUri: 'https://dev.example' })
    interaction.notify({ type: 'progress', message: 'waiting' })
    expect(openUrl).toHaveBeenCalledWith('https://auth.example/1')
    expect(openUrl).toHaveBeenCalledWith('https://dev.example')
    expect(tell).toHaveBeenCalledWith(expect.objectContaining({ command: 'Enter code ABCD at https://dev.example' }))
  })

  test('returns typed answers and the id of a chosen option', async () => {
    await expect(setup('  sk-123 ').interaction.prompt({ type: 'secret', message: 'API key' })).resolves.toBe('sk-123')
    await expect(
      setup('Personal').interaction.prompt({
        type: 'select',
        message: 'Workspace',
        options: [{ id: 'p1', label: 'Personal' }],
      }),
    ).resolves.toBe('p1')
  })

  test('rejects a cancelled, refused, empty or unknown answer', async () => {
    await expect(setup('Cancel').interaction.prompt({ type: 'text', message: 'q' })).rejects.toThrow(/cancelled/)
    await expect(setup('x', false).interaction.prompt({ type: 'text', message: 'q' })).rejects.toThrow(/cancelled/)
    await expect(setup(undefined).interaction.prompt({ type: 'manual_code', message: 'q' })).rejects.toThrow()
    await expect(
      setup('Nope').interaction.prompt({ type: 'select', message: 'q', options: [{ id: 'a', label: 'A' }] }),
    ).rejects.toThrow(/not one of/)
  })

  test('passes a prompt signal through so a beaten prompt can be withdrawn', async () => {
    const { interaction, ask } = setup('code')
    const signal = new AbortController().signal
    await interaction.prompt({ type: 'manual_code', message: 'Paste code', signal })
    expect(ask).toHaveBeenCalledWith(expect.anything(), signal)
  })
})

describe('toModelInfo', () => {
  test('lists signed-in providers first and marks the rest', () => {
    const models = [
      { provider: 'openai', id: 'gpt-5.5' },
      { provider: 'anthropic', id: 'claude-sonnet-5' },
    ]
    expect(toModelInfo(models, new Set(['anthropic']), (id) => (id === 'openai' ? 'OpenAI' : undefined))).toEqual([
      { id: 'anthropic/claude-sonnet-5', price: '' },
      { id: 'openai/gpt-5.5', price: '', signedIn: false, provider: 'OpenAI' },
    ])
  })
})

describe('signing in again', () => {
  test('says the saved sign-in was rejected', async () => {
    const ask = vi.fn(async () => ({ approved: true }))
    await askToSignIn(OPENAI, ask, true)
    const [approval] = ask.mock.calls[0] as unknown as [{ questions: { question: string }[] }]
    expect(approval.questions[0]!.question).toBe('OpenAI rejected the saved sign-in. Sign in again?')
  })

  test('recognises a rejected credential, and nothing a sign-in would not fix', () => {
    expect(isAuthFailure('OpenAI API error (401): Incorrect API key provided')).toBe(true)
    expect(isAuthFailure('Unauthorized')).toBe(true)
    expect(isAuthFailure('invalid x-api-key')).toBe(true)
    expect(isAuthFailure('xai API error (402): You have run out of credits')).toBe(false)
    expect(isAuthFailure('429 rate limited')).toBe(false)
  })
})
