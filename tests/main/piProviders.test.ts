import { describe, expect, test } from 'vitest'
import { providerAuthInfo, summarizeProviders } from '@main/runners/pi/providers'

const ANTHROPIC = { id: 'anthropic', name: 'Anthropic', oauth: 'Claude Pro/Max', apiKey: 'Anthropic API key' }
const OPENAI = { id: 'openai', name: 'OpenAI', apiKey: 'OpenAI API key' }
const CODEX = { id: 'openai-codex', name: 'OpenAI Codex', oauth: 'ChatGPT Plus/Pro' }
const HIDDEN = { id: 'nothing', name: 'Aardvark' }

describe('providerAuthInfo', () => {
  test('reads the sign-in facts Pi exposes', () => {
    expect(
      providerAuthInfo({
        id: 'anthropic',
        name: 'Anthropic',
        auth: { oauth: { name: 'Claude Pro/Max' }, apiKey: { name: 'Anthropic API key', login: () => {} } },
      }),
    ).toEqual(ANTHROPIC)
  })

  test('leaves out an API key that cannot be entered from Roster', () => {
    expect(providerAuthInfo({ id: 'x', name: 'X', auth: { apiKey: { name: 'K' } } })).toEqual({ id: 'x', name: 'X' })
  })
})

describe('summarizeProviders', () => {
  test('lists account sign-ins first, then by name, and leaves out providers with no way in', () => {
    const list = summarizeProviders([OPENAI, HIDDEN, ANTHROPIC, CODEX], new Set(), () => false)
    expect(list.map((p) => p.id)).toEqual(['anthropic', 'openai-codex', 'openai'])
  })

  test('marks what is signed in, and only calls it a subscription when it is', () => {
    const list = summarizeProviders([ANTHROPIC, OPENAI], new Set(['openai']), () => true)
    expect(list.find((p) => p.id === 'anthropic')).toMatchObject({ signedIn: false, subscription: false })
    expect(list.find((p) => p.id === 'openai')).toMatchObject({ signedIn: true, subscription: true })
  })

  test('offers each provider its ways in, account sign-in first', () => {
    const [anthropic] = summarizeProviders([ANTHROPIC], new Set(), () => false)
    expect(anthropic!.methods.map((m) => m.method)).toEqual(['oauth', 'api_key'])
  })
})
