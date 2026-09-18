import { afterEach, describe, expect, test, vi } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import type { SecretBox } from '@main/notion/secretBox'
import type { OAuthCallbackListener, OAuthCallbackOptions } from '@main/notion/loopbackCallback'
import { NotionMcpAuth } from '@main/notion/mcpAuth'
import { NotionMcpClient } from '@main/notion/mcpClient'

const REDIRECT = 'http://127.0.0.1:53682/notion/mcp-oauth'
const AUTH_SERVER = {
  issuer: 'https://mcp.notion.com',
  authorization_endpoint: 'https://mcp.notion.com/authorize',
  token_endpoint: 'https://mcp.notion.com/token',
  registration_endpoint: 'https://mcp.notion.com/register',
  response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'],
}

const box: SecretBox = { encrypt: (value) => value, decrypt: (value) => value }

let db: Db | null = null
afterEach(() => {
  vi.unstubAllGlobals()
  db?.close()
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Just enough of mcp.notion.com to reach the authorization redirect. */
function stubNotion(registrations: unknown[]): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/mcp') return new Response('', { status: 401 })
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return json({ resource: 'https://mcp.notion.com/mcp', authorization_servers: ['https://mcp.notion.com'] })
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') return json(AUTH_SERVER)
    if (url.pathname === '/register') {
      const metadata = JSON.parse(String(init?.body)) as Record<string, unknown>
      registrations.push(metadata)
      return json({ ...metadata, client_id: 'loopback-client' }, 201)
    }
    return new Response('', { status: 404 })
  })
}

function fakeListener(): { listen: (options: OAuthCallbackOptions) => Promise<OAuthCallbackListener>; close: ReturnType<typeof vi.fn> } {
  const close = vi.fn()
  const listen = async (): Promise<OAuthCallbackListener> => ({ redirectUrl: REDIRECT, done: new Promise(() => undefined), close })
  return { listen, close }
}

describe('hosted Notion MCP client sign-in', () => {
  test('registers and authorizes with the loopback listener as redirect', async () => {
    const registrations: unknown[] = []
    stubNotion(registrations)
    db = openDatabase(':memory:')
    const auth = new NotionMcpAuth(db, box)
    auth.saveClientInformation({ client_id: 'old-protocol-client', redirect_uris: ['roster://notion/mcp-oauth'] })
    const listener = fakeListener()

    const authorizationUrl = new URL(await new NotionMcpClient(auth, listener.listen).beginAuthorization())

    expect(registrations).toEqual([expect.objectContaining({ redirect_uris: [REDIRECT] })])
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(authorizationUrl.searchParams.get('client_id')).toBe('loopback-client')
    expect(listener.close).not.toHaveBeenCalled()
  })

  test('closes the listener and reports the failure when Notion cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline')
    })
    db = openDatabase(':memory:')
    const auth = new NotionMcpAuth(db, box)
    const listener = fakeListener()

    await expect(new NotionMcpClient(auth, listener.listen).beginAuthorization()).rejects.toThrow()

    expect(listener.close).toHaveBeenCalled()
    expect(auth.status().state).toBe('error')
  })
})
