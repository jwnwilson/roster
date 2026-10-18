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
    // MediaRecorder stop events and Opus padding can extend past the UI timer.
    // Keep the promised first 60 seconds rather than rejecting the whole clip.
    const bounded = channels.map((channel) => channel.subarray(0, Math.floor(decoded.sampleRate * MAX_VOICE_SECONDS)))
    return downmixAndResample(bounded, decoded.sampleRate).slice(0, MAX_VOICE_SAMPLES)
  } catch {
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
  private starting = false
  private generation = 0
  private monitorContext: AudioContext | null = null
  private monitorSource: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private monitorTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly onLevel?: (rms: number | null) => void) {}

  async start(): Promise<void> {
    if (this.recorder || this.starting) throw new Error('Voice recording is already active.')
    const mimeType = recorderMimeType()
    if (!mimeType) throw new Error('This version of Electron cannot record WebM/Opus audio.')

    const generation = ++this.generation
    this.starting = true
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : ''
      if (name === 'NotFoundError') throw new Error('No microphone is available.')
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('Microphone permission was not granted.')
      }
      throw new Error('Roster could not start microphone capture.')
    } finally {
      this.starting = false
    }

    if (generation !== this.generation) {
      for (const track of stream.getTracks()) track.stop()
      throw new Error('Voice recording was cancelled.')
    }
    this.stream = stream

    this.chunks = []
    this.acceptChunks = true
    try {
      const recorder = new MediaRecorder(stream, { mimeType })
      recorder.addEventListener('dataavailable', (event) => {
        if (this.acceptChunks && event.data.size > 0) this.chunks.push(event.data)
      })
      recorder.start()
      this.recorder = recorder
      this.startMonitoring(stream)
    } catch (cause) {
      this.release()
      throw cause
    }
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
    this.generation += 1
    try {
      if (this.recorder?.state !== 'inactive') this.recorder?.stop()
    } finally {
      this.release()
    }
  }

  private release(): void {
    this.releaseMonitoring()
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    this.recorder = null
    this.acceptChunks = false
    this.chunks = []
  }

  private startMonitoring(stream: MediaStream): void {
    if (!this.onLevel) return
    try {
      const context = new AudioContext()
      this.monitorContext = context
      this.monitorSource = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      this.analyser = analyser
      analyser.fftSize = 2048
      this.monitorSource.connect(analyser)
      // Deliberately not connected to speakers: inspect energy without feedback.
      const samples = new Float32Array(analyser.fftSize)
      this.monitorTimer = setInterval(() => {
        try {
          analyser.getFloatTimeDomainData(samples)
          let energy = 0
          let sum = 0
          for (const sample of samples) { energy += sample * sample; sum += sample }
          // Ignore DC offsets, matching the decoded recording health check.
          this.onLevel?.(Math.sqrt(Math.max(0, energy / samples.length - (sum / samples.length) ** 2)))
        } catch {
          this.releaseMonitoring()
          this.onLevel?.(null)
        }
      }, 100)
      void context.resume().catch(() => {
        if (this.monitorContext !== context) return
        this.releaseMonitoring()
        this.onLevel?.(null)
      })
    } catch {
      this.releaseMonitoring()
      this.onLevel(null)
    }
  }

  private releaseMonitoring(): void {
    if (this.monitorTimer !== null) clearInterval(this.monitorTimer)
    this.monitorTimer = null
    this.monitorSource?.disconnect()
    this.analyser?.disconnect()
    this.monitorSource = null
    this.analyser = null
    const context = this.monitorContext
    this.monitorContext = null
    if (context) void context.close().catch(() => undefined)
  }
}
