import { describe, expect, test, vi } from 'vitest'
import { OpenAiTranscriptionClient } from '@main/voice/transcription'

const AUDIO = new Uint8Array([1, 2, 3]).buffer

function makeClient(
  response: Response = new Response(JSON.stringify({ text: 'Find the leak.' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
) {
  const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch
  return { client: new OpenAiTranscriptionClient(() => 'sk-test', fetchImpl), fetchImpl }
}

describe('OpenAiTranscriptionClient', () => {
  test('sends a completed audio clip with the key confined to main', async () => {
    const { client, fetchImpl } = makeClient()

    await expect(client.transcribe({ audio: AUDIO, mimeType: 'audio/webm;codecs=opus' })).resolves.toEqual({
      text: 'Find the leak.',
    })

    const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? []
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test')
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get('model')).toBe('gpt-4o-mini-transcribe')
  })

  test('rejects an absent credential before it attempts a request', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const client = new OpenAiTranscriptionClient(() => undefined, fetchImpl)

    await expect(client.transcribe({ audio: AUDIO, mimeType: 'audio/webm' })).rejects.toThrow(
      'OPENAI_API_KEY',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('does not send an empty or unsupported recording', async () => {
    const { client, fetchImpl } = makeClient()

    await expect(client.transcribe({ audio: new ArrayBuffer(0), mimeType: 'audio/webm' })).rejects.toThrow(
      'No audio',
    )
    await expect(client.transcribe({ audio: AUDIO, mimeType: 'video/webm' })).rejects.toThrow(
      'format',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('makes an authentication failure actionable', async () => {
    const { client } = makeClient(new Response('', { status: 401 }))

    await expect(client.transcribe({ audio: AUDIO, mimeType: 'audio/webm' })).rejects.toThrow(
      'could not authenticate',
    )
  })
})
