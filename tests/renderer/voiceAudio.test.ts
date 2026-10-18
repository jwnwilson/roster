import { describe, expect, test, vi } from 'vitest'
import { BrowserVoiceCapture, decodeVoiceBlob, downmixAndResample, MAX_VOICE_SAMPLES, recorderMimeType } from '@/chat/voice/audio'

describe('voice audio conversion', () => {
  test('releases late microphone permission after cancellation', async () => {
    let grant!: (stream: MediaStream) => void
    const stopTrack = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => new Promise<MediaStream>((resolve) => { grant = resolve }) },
    })
    class Recorder { static isTypeSupported(): boolean { return true } }
    vi.stubGlobal('MediaRecorder', Recorder)
    const capture = new BrowserVoiceCapture()
    const pending = capture.start()
    capture.cancel()
    grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream)
    await expect(pending).rejects.toThrow('cancelled')
    expect(stopTrack).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  test('releases the microphone when recorder construction fails', async () => {
    const stopTrack = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }) },
    })
    class Recorder {
      static isTypeSupported(): boolean { return true }
      constructor() { throw new Error('recorder failed') }
    }
    vi.stubGlobal('MediaRecorder', Recorder)
    await expect(new BrowserVoiceCapture().start()).rejects.toThrow('recorder failed')
    expect(stopTrack).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
  test('selects the explicit Opus format and reports no unsupported fallback', () => {
    expect(recorderMimeType((type) => type === 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus')
    expect(recorderMimeType(() => false)).toBeNull()
  })

  test('downmixes every channel and resamples deterministically', () => {
    const left = new Float32Array([1, 0, -1, 0])
    const right = new Float32Array([-1, 1, 1, -1])
    expect(Array.from(downmixAndResample([left, right], 4, 2))).toEqual([0, 0])
  })

  test('closes the decoder and caps timer/codec overshoot at the sample budget', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const samples = new Float32Array(MAX_VOICE_SAMPLES + 1)
    const context = {
      decodeAudioData: vi.fn().mockResolvedValue({
        numberOfChannels: 1,
        sampleRate: 16_000,
        getChannelData: () => samples,
      }),
      close,
    }

    await expect(decodeVoiceBlob(new Blob(['x']), () => context)).resolves.toHaveLength(MAX_VOICE_SAMPLES)
    expect(close).toHaveBeenCalled()
  })

  test('stops every microphone track when a recording is cancelled', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
    class Recorder extends EventTarget {
      static isTypeSupported(): boolean { return true }
      readonly mimeType = 'audio/webm;codecs=opus'
      state: RecordingState = 'recording'
      constructor(_stream: MediaStream, _options: MediaRecorderOptions) { super() }
      start(): void {}
      stop(): void { this.state = 'inactive' }
    }
    vi.stubGlobal('MediaRecorder', Recorder)
    const capture = new BrowserVoiceCapture()

    await capture.start()
    capture.cancel()

    expect(stopTrack).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  test('turns a denied permission into an actionable error', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')) },
    })
    class Recorder {
      static isTypeSupported(): boolean { return true }
    }
    vi.stubGlobal('MediaRecorder', Recorder)

    await expect(new BrowserVoiceCapture().start()).rejects.toThrow('permission was not granted')
    vi.unstubAllGlobals()
  })
})
