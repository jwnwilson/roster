import { afterEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { NotionMcpAuth } from '@main/notion/mcpAuth'
import type { SecretBox } from '@main/notion/secretBox'

const box: SecretBox = {
  encrypt: (value) => `encrypted:${Buffer.from(value).toString('base64')}`,
  decrypt: (value) => Buffer.from(value.replace('encrypted:', ''), 'base64').toString(),
}

const REDIRECT = 'http://127.0.0.1:53682/notion/mcp-oauth'

let db: Db | null = null
afterEach(() => db?.close())

function subject(): NotionMcpAuth {
  db = openDatabase(':memory:')
  return new NotionMcpAuth(db, box)
}

describe('hosted Notion MCP OAuth credentials', () => {
  test('keeps dynamic registration and tokens encrypted while reporting only safe status', async () => {
    const auth = subject()
    auth.saveClientInformation({ client_id: 'registered-client' })
    auth.saveTokens({ access_token: 'access-token', refresh_token: 'refresh-token', token_type: 'Bearer' })
    auth.setWorkspaceName('Product')

    expect(auth.status()).toEqual({ state: 'connected', workspaceName: 'Product' })
    expect(auth.tokens()).toEqual({ access_token: 'access-token', refresh_token: 'refresh-token', token_type: 'Bearer' })
    const row = db?.prepare('SELECT encrypted_payload FROM notion_mcp_auth').get() as { encrypted_payload: string }
    expect(row.encrypted_payload).toMatch(/^encrypted:/)
    expect(JSON.stringify(row)).not.toContain('access-token')
    expect(auth.clientMetadata).toMatchObject({ token_endpoint_auth_method: 'none' })
  })

  test('registers the loopback redirect of the current attempt', () => {
    const auth = subject()
    auth.startAttempt(REDIRECT)

    expect(auth.redirectUrl).toBe(REDIRECT)
    expect(auth.clientMetadata.redirect_uris).toEqual([REDIRECT])
  })

  test('always reports a redirect so the SDK never treats sign-in as non-interactive', () => {
    expect(subject().redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1/)
  })

  test('forces re-registration when the stored client was registered for another redirect', () => {
    const auth = subject()
    auth.saveClientInformation({ client_id: 'old-protocol-client', redirect_uris: ['roster://notion/mcp-oauth'] })

    expect(auth.clientInformation()).toMatchObject({ client_id: 'old-protocol-client' })
    auth.startAttempt(REDIRECT)
    expect(auth.clientInformation()).toBeUndefined()

    auth.saveClientInformation({ client_id: 'loopback-client', redirect_uris: [REDIRECT] })
    expect(auth.clientInformation()).toMatchObject({ client_id: 'loopback-client' })
  })

  test('accepts only the callback issued for this attempt', async () => {
    const auth = subject()
    auth.startAttempt(REDIRECT)
    const state = await auth.state()

    expect(auth.consumeCallback(`${REDIRECT}?code=one-time&state=${state}`)).toBe('one-time')
    expect(() => auth.consumeCallback(`${REDIRECT}?code=again&state=${state}`)).toThrow('invalid or has expired')
  })

  test('rejects a callback with the wrong state or redirect', async () => {
    const auth = subject()
    auth.startAttempt(REDIRECT)
    await auth.state()

    expect(() => auth.consumeCallback(`${REDIRECT}?code=x&state=wrong`)).toThrow('did not match')
    expect(() => auth.consumeCallback('http://127.0.0.1:1/elsewhere?code=x&state=wrong')).toThrow('not a Notion')
    expect(() => auth.consumeCallback('roster://notion/mcp-oauth?code=x&state=wrong')).toThrow('not a Notion')
  })

  test('explains a declined authorization instead of calling it expired', async () => {
    const auth = subject()
    auth.startAttempt(REDIRECT)
    const state = await auth.state()

    expect(() => auth.consumeCallback(`${REDIRECT}?error=access_denied&error_description=User+cancelled&state=${state}`)).toThrow(
      'User cancelled',
    )
  })

  test('does not let a response without this attempt\'s state report a refusal', async () => {
    const auth = subject()
    auth.startAttempt(REDIRECT)
    await auth.state()

    expect(() => auth.consumeCallback(`${REDIRECT}?error=access_denied&error_description=Forged&state=wrong`)).toThrow(
      'did not match',
    )
  })

  test('clears only the unified MCP credential on disconnect', () => {
    const auth = subject()
    auth.saveTokens({ access_token: 'access', token_type: 'Bearer' })
    auth.clear()

    expect(auth.status()).toEqual({ state: 'disconnected' })
    expect(db?.prepare('SELECT * FROM notion_mcp_auth').get()).toBeUndefined()
  })
})
