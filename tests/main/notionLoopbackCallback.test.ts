import { afterEach, describe, expect, test } from 'vitest'
import { listenForOAuthCallback, type OAuthCallbackListener } from '@main/notion/loopbackCallback'

const CALLBACK_PATH = '/notion/mcp-oauth'
let listener: OAuthCallbackListener | null = null

afterEach(() => {
  listener?.close()
  listener = null
})

describe('loopback OAuth callback listener', () => {
  test('listens on an ephemeral IPv4 loopback port at the callback path', async () => {
    listener = await listenForOAuthCallback({ path: CALLBACK_PATH, timeoutMs: 5_000, handle: async () => undefined })

    const redirect = new URL(listener.redirectUrl)
    expect(redirect.protocol).toBe('http:')
    expect(redirect.hostname).toBe('127.0.0.1')
    expect(Number(redirect.port)).toBeGreaterThan(0)
    expect(redirect.pathname).toBe(CALLBACK_PATH)
  })

  test('hands the full callback URL to the handler and tells the browser it succeeded', async () => {
    const received: string[] = []
    listener = await listenForOAuthCallback({
      path: CALLBACK_PATH,
      timeoutMs: 5_000,
      handle: async (url) => {
        received.push(url)
      },
    })

    const response = await fetch(`${listener.redirectUrl}?code=one-time&state=abc`)
    await listener.done

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('return to Roster')
    expect(received).toEqual([`${listener.redirectUrl}?code=one-time&state=abc`])
  })

  test('shows the handler failure in the browser and rejects done', async () => {
    listener = await listenForOAuthCallback({
      path: CALLBACK_PATH,
      timeoutMs: 5_000,
      handle: async () => {
        throw new Error('did not <match>')
      },
    })
    const done = listener.done.catch((cause: unknown) => cause)

    const response = await fetch(`${listener.redirectUrl}?code=x&state=y`)

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('did not &lt;match&gt;')
    expect(await done).toBeInstanceOf(Error)
  })

  test('ignores requests for other paths without consuming the attempt', async () => {
    const received: string[] = []
    listener = await listenForOAuthCallback({
      path: CALLBACK_PATH,
      timeoutMs: 5_000,
      handle: async (url) => {
        received.push(url)
      },
    })
    const origin = new URL(listener.redirectUrl).origin

    const favicon = await fetch(`${origin}/favicon.ico`)
    const callback = await fetch(`${listener.redirectUrl}?code=real&state=s`)
    await listener.done

    expect(favicon.status).toBe(404)
    expect(callback.status).toBe(200)
    expect(received).toHaveLength(1)
  })

  test('rejects done when no callback arrives in time', async () => {
    listener = await listenForOAuthCallback({ path: CALLBACK_PATH, timeoutMs: 20, handle: async () => undefined })

    await expect(listener.done).rejects.toThrow('timed out')
  })

  test('times out a callback whose handling stalls', async () => {
    listener = await listenForOAuthCallback({ path: CALLBACK_PATH, timeoutMs: 50, handle: () => new Promise(() => undefined) })
    const done = listener.done.catch((cause: unknown) => cause)

    void fetch(`${listener.redirectUrl}?code=x&state=y`).catch(() => undefined)

    expect(await done).toMatchObject({ message: expect.stringContaining('timed out') })
  })

  test('close stops listening without reporting a failure', async () => {
    listener = await listenForOAuthCallback({ path: CALLBACK_PATH, timeoutMs: 5_000, handle: async () => undefined })
    const redirectUrl = listener.redirectUrl

    listener.close()

    await expect(listener.done).resolves.toBeUndefined()
    await expect(fetch(redirectUrl)).rejects.toThrow()
  })
})
