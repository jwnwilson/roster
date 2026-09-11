import type { TranscriptionInput, TranscriptionResult } from '../../../shared/ipc'

const TRANSCRIPT_URL = 'https://api.openai.com/v1/audio/transcriptions'
const MODEL = 'gpt-4o-mini-transcribe'
const MAX_AUDIO_BYTES = 20 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'])

interface TranscriptionReply {
  text?: unknown
}

/**
 * The only OpenAI Audio boundary. A completed clip arrives from the renderer;
 * the key is resolved here in main and never crosses the preload bridge.
 */
export class OpenAiTranscriptionClient {
  constructor(
    private readonly apiKey: () => string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const key = this.apiKey()
    if (!key) throw new Error('Voice transcription needs OPENAI_API_KEY in Roster’s environment.')

    const mimeType = normaliseMimeType(input.mimeType)
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new Error('Roster could not record audio in a format voice transcription supports.')
    }
    if (input.audio.byteLength === 0) throw new Error('No audio was recorded.')
    if (input.audio.byteLength > MAX_AUDIO_BYTES) {
      throw new Error('That recording is too long. Keep voice messages under 20 MB.')
    }

    const form = new FormData()
    form.append('model', MODEL)
    form.append('file', new Blob([input.audio], { type: mimeType }), fileName(mimeType))

    let response: Response
    try {
      response = await this.fetchImpl(TRANSCRIPT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      })
    } catch {
      throw new Error('Roster could not reach the voice transcription service. Check your connection and try again.')
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error('Voice transcription could not authenticate. Check OPENAI_API_KEY and try again.')
    }
    if (!response.ok) throw new Error(`Voice transcription failed (${response.status}). Please try again.`)

    const reply = (await response.json()) as TranscriptionReply
    if (typeof reply.text !== 'string') throw new Error('Voice transcription returned no text. Please try again.')
    return { text: reply.text.trim() }
  }
}

function normaliseMimeType(value: string): string {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function fileName(mimeType: string): string {
  const extension = mimeType === 'audio/webm' ? 'webm' : mimeType === 'audio/ogg' ? 'ogg' : mimeType === 'audio/mp4' ? 'm4a' : mimeType === 'audio/mpeg' ? 'mp3' : 'wav'
  return `roster-voice.${extension}`
}
