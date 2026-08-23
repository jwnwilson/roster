import { describe, expect, test } from 'vitest'
import { detectRunner, type DetectDeps } from '@main/auth/detect'

/** Nothing installed, nothing authenticated, no env vars. */
const BARE: DetectDeps = {
  which: async () => null,
  version: async () => null,
  readFile: async () => null,
  keychainHas: async () => false,
  env: {},
}

function deps(overrides: Partial<DetectDeps>): DetectDeps {
  return { ...BARE, ...overrides }
}

describe('detectRunner — not installed', () => {
  test('reports a missing binary as not installed and not ready', async () => {
    const status = await detectRunner('claude', BARE)

    expect(status.installed).toBe(false)
    expect(status.ready).toBe(false)
    expect(status.auth).toBe('none')
    expect(status.detail).toMatch(/not installed/i)
  })

  test('maps each builtin runner to its provider label', async () => {
    expect((await detectRunner('claude', BARE)).provider).toBe('Anthropic')
    expect((await detectRunner('codex', BARE)).provider).toBe('OpenAI')
    expect((await detectRunner('gemini', BARE)).provider).toBe('Google')
  })
})

describe('detectRunner — claude', () => {
  const installed = { which: async () => '/usr/local/bin/claude', version: async () => '2.1.241' }

  test('is ready via a keychain subscription login', async () => {
    const status = await detectRunner('claude', deps({ ...installed, keychainHas: async () => true }))

    expect(status.ready).toBe(true)
    expect(status.auth).toBe('subscription')
    expect(status.version).toBe('2.1.241')
  })

  test('is ready via an API key in the environment', async () => {
    const status = await detectRunner(
      'claude',
      deps({ ...installed, env: { ANTHROPIC_API_KEY: 'sk-ant-test' } }),
    )

    expect(status.ready).toBe(true)
    expect(status.auth).toBe('api-key')
  })

  test('prefers an explicit API key over a stored subscription', async () => {
    const status = await detectRunner(
      'claude',
      deps({ ...installed, keychainHas: async () => true, env: { ANTHROPIC_API_KEY: 'sk-ant' } }),
    )

    expect(status.auth).toBe('api-key')
  })

  test('is installed but not ready when logged out', async () => {
    const status = await detectRunner('claude', deps(installed))

    expect(status.installed).toBe(true)
    expect(status.ready).toBe(false)
    expect(status.detail).toMatch(/claude auth login/)
  })

  test('falls back to a credentials file when no keychain is available', async () => {
    const status = await detectRunner(
      'claude',
      deps({ ...installed, readFile: async (p) => (p.endsWith('.credentials.json') ? '{}' : null) }),
    )

    expect(status.auth).toBe('subscription')
    expect(status.ready).toBe(true)
  })
})

describe('detectRunner — codex', () => {
  const installed = { which: async () => '/usr/bin/codex', version: async () => '0.147.0' }

  test('reads a ChatGPT subscription from auth.json', async () => {
    const status = await detectRunner(
      'codex',
      deps({
        ...installed,
        readFile: async () => JSON.stringify({ auth_mode: 'chatgpt', tokens: { id: 'x' } }),
      }),
    )

    expect(status.auth).toBe('subscription')
    expect(status.ready).toBe(true)
  })

  test('reads an API key mode from auth.json', async () => {
    const status = await detectRunner(
      'codex',
      deps({ ...installed, readFile: async () => JSON.stringify({ auth_mode: 'apikey' }) }),
    )

    expect(status.auth).toBe('api-key')
  })

  test('treats an unparseable auth.json as logged out rather than throwing', async () => {
    const status = await detectRunner('codex', deps({ ...installed, readFile: async () => 'not json' }))

    expect(status.ready).toBe(false)
    expect(status.auth).toBe('none')
    expect(status.detail).toMatch(/codex login/)
  })
})

describe('detectRunner — custom', () => {
  test('an unknown runner id is reported as custom and never assumed ready', async () => {
    const status = await detectRunner('my-cli', BARE)

    expect(status.provider).toBe('Custom')
    expect(status.ready).toBe(false)
  })

  test('a custom runner resolving on PATH is ready without an auth check', async () => {
    // Roster cannot know how a user's own CLI authenticates, so presence is
    // the only claim it makes.
    const status = await detectRunner('my-cli', deps({ which: async () => '/opt/bin/my-cli' }))

    expect(status.installed).toBe(true)
    expect(status.ready).toBe(true)
    expect(status.auth).toBe('none')
  })
})
