import { afterEach, describe, expect, test, vi } from 'vitest'
import { BrowserVoiceCapture, decodeVoiceBlob, downmixAndResample, MAX_VOICE_SAMPLES, recorderMimeType } from '@/chat/voice/audio'

describe('voice audio conversion', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  test.each(['cancel', 'stop', 'monitor failure', 'resume failure', 'read failure'] as const)('releases signal monitoring on %s', async (action) => {
    vi.useFakeTimers()
    const close = vi.fn().mockResolvedValue(undefined)
    const disconnect = vi.fn()
    const stopTrack = vi.fn()
    const onLevel = vi.fn()
    class Context {
      close = close
      resume = action === 'resume failure' ? vi.fn().mockRejectedValue(new Error('suspended')) : vi.fn().mockResolvedValue(undefined)
      createMediaStreamSource() { return { connect: vi.fn(), disconnect } }
      createAnalyser() {
        if (action === 'monitor failure') throw new Error('monitor unavailable')
        return { fftSize: 2048, disconnect, getFloatTimeDomainData: (buffer: Float32Array) => {
          if (action === 'read failure') throw new Error('closed')
          for (let i = 0; i < buffer.length; i++) buffer[i] = i % 2 ? 0.1 : -0.1
        } }
      }
      decodeAudioData = vi.fn().mockResolvedValue({ numberOfChannels: 1, sampleRate: 16000, getChannelData: () => new Float32Array([0.1]) })
    }
    class Recorder extends EventTarget {
      static isTypeSupported() { return true }
      state = 'recording'
      mimeType = 'audio/webm'
      start() {}
      stop() { this.state = 'inactive'; this.dispatchEvent(new Event('stop')) }
    }
    vi.stubGlobal('AudioContext', Context)
    vi.stubGlobal('MediaRecorder', Recorder)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: stopTrack }] }),
    } })
    const capture = new BrowserVoiceCapture(onLevel)
    await capture.start()
    vi.advanceTimersByTime(100)
    if (action.endsWith('failure')) expect(onLevel).toHaveBeenCalledWith(null)
    else expect(onLevel.mock.lastCall![0]).toBeCloseTo(0.1)
    if (action === 'stop') await capture.stop()
    else capture.cancel()
    const calls = onLevel.mock.calls.length
    vi.advanceTimersByTime(500)
    expect(onLevel).toHaveBeenCalledTimes(calls)
    expect(close).toHaveBeenCalled()
    expect(stopTrack).toHaveBeenCalledOnce()
    if (action !== 'monitor failure') expect(disconnect).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  test('releases late microphone permission after cancellation', async () => {
    let grant!: (stream: MediaStream) => void
    const stopTrack = vi.fn()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => new Promise<MediaStream>((resolve) => { grant = resolve }) },
    })
    class Recorder { static isTypeSupported(): boolean { return true } }
    vi.stubGlobal('MediaRecorder', Recorder)
    const createContext = vi.fn()
    vi.stubGlobal('AudioContext', createContext)
    const capture = new BrowserVoiceCapture(vi.fn())
    const pending = capture.start()
    capture.cancel()
    grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream)
    await expect(pending).rejects.toThrow('cancelled')
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(createContext).not.toHaveBeenCalled()
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
    const createContext = vi.fn()
    vi.stubGlobal('AudioContext', createContext)
    await expect(new BrowserVoiceCapture(vi.fn()).start()).rejects.toThrow('recorder failed')
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(createContext).not.toHaveBeenCalled()
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
