import { afterEach, describe, expect, test, vi } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { NotionAuth, type SecretBox } from '@main/notion/auth'

const box: SecretBox = {
  encrypt: (value) => `encrypted:${Buffer.from(value).toString('base64')}`,
  decrypt: (value) => Buffer.from(value.replace('encrypted:', ''), 'base64').toString(),
}
const config = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'roster://notion/oauth',
}

let db: Db | null = null
afterEach(() => db?.close())

function auth(reply: unknown = { access_token: 'access', refresh_token: 'refresh', workspace_name: 'My space' }) {
  db = openDatabase(':memory:')
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(reply), { status: 200 }))
  return { auth: new NotionAuth(db, box, config, fetchImpl as unknown as typeof fetch, () => 1_000), fetchImpl }
}

describe('Notion public OAuth', () => {
  test('starts authorization with a high-entropy state and exchanges only its callback', async () => {
    const { auth: subject, fetchImpl } = auth()
    const authorization = new URL(subject.begin())
    const state = authorization.searchParams.get('state')

    expect(authorization.origin + authorization.pathname).toBe('https://api.notion.com/v1/oauth/authorize')
    expect(authorization.searchParams.get('owner')).toBe('user')
    expect(authorization.searchParams.get('client_id')).toBe('client-id')
    expect(authorization.searchParams.get('response_type')).toBe('code')
    expect(state).toHaveLength(43)

    await subject.complete(`roster://notion/oauth?code=one-time-code&state=${state}`)

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.notion.com/v1/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(subject.status()).toEqual({ state: 'connected', workspaceName: 'My space' })
    expect(db?.prepare('SELECT encrypted_payload FROM notion_auth').get()).toEqual({
      encrypted_payload: expect.stringMatching(/^encrypted:/),
    })
    expect(JSON.stringify(db?.prepare('SELECT * FROM notion_auth').get())).not.toContain('access')
  })

  test('rejects a callback for another authorization attempt without calling Notion', async () => {
    const { auth: subject, fetchImpl } = auth()
    subject.begin()

    await expect(subject.complete('roster://notion/oauth?code=code&state=wrong')).rejects.toThrow('did not match')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('refreshes an expired token and retains its refresh token when Notion omits a replacement', async () => {
    db = openDatabase(':memory:')
    let time = 0
    const now = () => time
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expires_in: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new' }), { status: 200 }))
    const subject = new NotionAuth(db, box, config, fetchImpl as unknown as typeof fetch, now)
    const state = new URL(subject.begin()).searchParams.get('state')
    await subject.complete(`roster://notion/oauth?code=code&state=${state}`)

    time = 2_000

    await expect(subject.accessToken()).resolves.toBe('new')
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh',
      redirect_uri: config.redirectUri,
    })
  })

  test('does not pretend an unconfigured build can connect', () => {
    db = openDatabase(':memory:')
    const subject = new NotionAuth(db, box, null)
    expect(subject.status()).toEqual({ state: 'needs_configuration', message: expect.any(String) })
    expect(() => subject.begin()).toThrow('not configured')
  })
})
