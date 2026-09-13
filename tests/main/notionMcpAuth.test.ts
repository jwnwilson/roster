import { afterEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { NotionMcpAuth } from '@main/notion/mcpAuth'
import type { SecretBox } from '@main/notion/auth'

const box: SecretBox = {
  encrypt: (value) => `encrypted:${Buffer.from(value).toString('base64')}`,
  decrypt: (value) => Buffer.from(value.replace('encrypted:', ''), 'base64').toString(),
}

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
    expect(auth.clientMetadata).toMatchObject({
      redirect_uris: ['roster://notion/mcp-oauth'],
      token_endpoint_auth_method: 'none',
    })
  })

  test('accepts only the callback issued for this attempt', async () => {
    const auth = subject()
    auth.startAttempt()
    const state = await auth.state()

    expect(auth.consumeCallback(`roster://notion/mcp-oauth?code=one-time&state=${state}`)).toBe('one-time')
    expect(() => auth.consumeCallback(`roster://notion/mcp-oauth?code=again&state=${state}`)).toThrow('invalid or has expired')
  })

  test('rejects a callback with the wrong state or redirect', async () => {
    const auth = subject()
    auth.startAttempt()
    await auth.state()

    expect(() => auth.consumeCallback('roster://notion/mcp-oauth?code=x&state=wrong')).toThrow('did not match')
    expect(() => auth.consumeCallback('roster://notion/oauth?code=x&state=wrong')).toThrow('not a Notion')
  })

  test('clears only the unified MCP credential on disconnect', () => {
    const auth = subject()
    auth.saveTokens({ access_token: 'access', token_type: 'Bearer' })
    auth.clear()

    expect(auth.status()).toEqual({ state: 'disconnected' })
    expect(db?.prepare('SELECT * FROM notion_mcp_auth').get()).toBeUndefined()
  })
})
