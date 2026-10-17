export const VOICE_SAMPLE_RATE = 16_000
export const MAX_VOICE_SECONDS = 60
export const MAX_VOICE_SAMPLES = VOICE_SAMPLE_RATE * MAX_VOICE_SECONDS

const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm'] as const

export function recorderMimeType(
  supports: (mimeType: string) => boolean = (mimeType) => MediaRecorder.isTypeSupported(mimeType),
): string | null {
  return RECORDER_TYPES.find(supports) ?? null
}
export function downmixAndResample(
  channels: readonly Float32Array[],
  sourceRate: number,
  targetRate = VOICE_SAMPLE_RATE,
): Float32Array {
  if (channels.length === 0 || sourceRate <= 0 || targetRate <= 0) return new Float32Array()
  const sourceLength = Math.min(...channels.map((channel) => channel.length))
  const outputLength = Math.floor(sourceLength * targetRate / sourceRate)
  const output = new Float32Array(outputLength)

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * sourceRate / targetRate
    const before = Math.min(Math.floor(sourcePosition), sourceLength - 1)
    const after = Math.min(before + 1, sourceLength - 1)
    const mix = sourcePosition - before
    let sample = 0
    for (const channel of channels) {
      sample += channel[before]! + (channel[after]! - channel[before]!) * mix
    }
    output[index] = Math.max(-1, Math.min(1, sample / channels.length))
  }
  return output
}

interface AudioContextLike {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
  close(): Promise<void>
}

type AudioContextFactory = () => AudioContextLike

export async function decodeVoiceBlob(
  blob: Blob,
  createContext: AudioContextFactory = () => new AudioContext(),
): Promise<Float32Array> {
  const context = createContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const channels = Array.from(
      { length: decoded.numberOfChannels },
      (_, index) => decoded.getChannelData(index),
    )
    const result = downmixAndResample(channels, decoded.sampleRate)
    if (result.length > MAX_VOICE_SAMPLES) throw new Error('Voice recordings are limited to 60 seconds.')
    return result
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('limited to')) throw cause
    throw new Error('Roster could not decode that voice recording.')
  } finally {
    await context.close()
  }
}

export class BrowserVoiceCapture {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private acceptChunks = false

  async start(): Promise<void> {
    if (this.recorder) throw new Error('Voice recording is already active.')
    const mimeType = recorderMimeType()
    if (!mimeType) throw new Error('This version of Electron cannot record WebM/Opus audio.')

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : ''
      if (name === 'NotFoundError') throw new Error('No microphone is available.')
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('Microphone permission was not granted.')
      }
      throw new Error('Roster could not start microphone capture.')
    }

    this.chunks = []
    this.acceptChunks = true
    const recorder = new MediaRecorder(this.stream, { mimeType })
    recorder.addEventListener('dataavailable', (event) => {
      if (this.acceptChunks && event.data.size > 0) this.chunks.push(event.data)
    })
    recorder.start()
    this.recorder = recorder
  }

  async stop(): Promise<Float32Array> {
    const recorder = this.recorder
    if (!recorder) throw new Error('Voice recording is not active.')
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.addEventListener('stop', () => resolve(), { once: true })
      recorder.addEventListener('error', () => reject(new Error('Voice recording failed.')), { once: true })
    })
    let blob: Blob
    try {
      recorder.stop()
      await stopped
      blob = new Blob(this.chunks, { type: recorder.mimeType })
    } finally {
      this.release()
    }
    return decodeVoiceBlob(blob)
  }

  cancel(): void {
    if (this.recorder?.state !== 'inactive') this.recorder?.stop()
    this.release()
  }

  private release(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    this.recorder = null
    this.acceptChunks = false
    this.chunks = []
  }
}
