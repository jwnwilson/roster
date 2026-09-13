import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const LOOPBACK_HOST = '127.0.0.1'

export interface OAuthCallbackOptions {
  /** Path the authorization server redirects to, e.g. `/notion/mcp-oauth`. */
  path: string
  timeoutMs: number
  /** Completes sign-in; its outcome is what the browser tab reports. */
  handle: (callbackUrl: string) => Promise<void>
}

export interface OAuthCallbackListener {
  readonly redirectUrl: string
  /** Settles once the callback is handled, the attempt times out, or it is closed. */
  readonly done: Promise<void>
  close(): void
}

/**
 * A one-shot RFC 8252 loopback redirect for a native OAuth sign-in.
 *
 * The callback reaches exactly the process that began the attempt, so it
 * works identically in `electron-vite dev` and a packaged build — unlike a
 * custom URL scheme, which macOS routes to whichever bundle last claimed it.
 */
export async function listenForOAuthCallback(options: OAuthCallbackOptions): Promise<OAuthCallbackListener> {
  let settle: (cause?: Error) => void = () => undefined
  const done = new Promise<void>((resolve, reject) => {
    settle = (cause) => (cause ? reject(cause) : resolve())
  })
  let finished = false
  let timer: NodeJS.Timeout | undefined

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`)
    if (finished || request.method !== 'GET' || url.pathname !== options.path) {
      response.writeHead(404).end()
      return
    }
    // The timer keeps running: it also bounds a code exchange that stalls.
    finished = true
    void answer(request, response, options.handle, redirectUrl).then(finish)
  })

  let settled = false
  function finish(cause?: Error): void {
    if (settled) return
    settled = true
    finished = true
    clearTimeout(timer)
    // Idle sockets only: the browser's in-flight response must still flush.
    server.close()
    server.closeIdleConnections()
    settle(cause)
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const { port } = server.address() as AddressInfo
  const redirectUrl = `http://${LOOPBACK_HOST}:${port}${options.path}`

  timer = setTimeout(() => finish(new Error('Notion sign-in timed out. Start again.')), options.timeoutMs)
  // A forgotten sign-in must not keep the app alive at quit.
  timer.unref()
  server.unref()

  return { redirectUrl, done, close: () => finish() }
}

async function answer(
  request: IncomingMessage,
  response: ServerResponse,
  handle: OAuthCallbackOptions['handle'],
  redirectUrl: string,
): Promise<Error | undefined> {
  const callbackUrl = new URL(request.url ?? '', redirectUrl).toString()
  try {
    await handle(callbackUrl)
    respond(response, 200, 'Notion is connected', 'You can close this tab and return to Roster.')
    return undefined
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    respond(response, 400, 'Notion could not be connected', error.message)
    return error
  }
}

function respond(response: ServerResponse, status: number, title: string, detail: string): void {
  const body = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<body style="font:15px system-ui;margin:4rem auto;max-width:32rem;padding:0 1rem">
<h1 style="font-size:1.25rem">${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></body>`
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(body)
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char)
}
