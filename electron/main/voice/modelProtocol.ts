import { readFile } from 'node:fs/promises'
import { protocol } from 'electron'
import type { VoiceModelStore } from './modelStore'

export const VOICE_MODEL_SCHEME = 'roster-model'

/** Must run before app ready so Chromium treats model fetches as secure. */
export function registerVoiceModelScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: VOICE_MODEL_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ])
}
export function registerVoiceModelProtocol(store: VoiceModelStore): void {
  protocol.handle(VOICE_MODEL_SCHEME, async (request) => {
    const file = await store.fileForUrl(request.url)
    if (!file) return new Response('Voice model file is unavailable.', { status: 404 })
    const body = await readFile(file)
    const contentType = file.endsWith('.json')
      ? 'application/json'
      : file.endsWith('.txt')
        ? 'text/plain; charset=utf-8'
        : 'application/octet-stream'
    return new Response(body, {
      headers: {
        'content-type': contentType,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    })
  })
}
