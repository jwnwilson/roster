import type { VoiceWorkerReply, VoiceWorkerRequest } from '@shared/voice'

type WorkerFactory = () => Worker

interface PendingJob {
  resolve(value: string): void
  reject(error: Error): void
}
const IDLE_TIMEOUT_MS = 120_000

export class VoiceWorkerClient {
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private readyResolve: (() => void) | null = null
  private readyReject: ((error: Error) => void) | null = null
  private initJobId: string | null = null
  private active: PendingJob | null = null
  private activeJobId: string | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly createWorker: WorkerFactory = () =>
      new Worker(new URL('./transcription.worker.ts', import.meta.url), { type: 'module' }),
  ) {}

  async transcribe(audio: Float32Array): Promise<string> {
    if (this.active) throw new Error('Voice transcription is already running.')
    await this.ensureReady()
    this.clearIdleTimer()
    const jobId = crypto.randomUUID()
    this.activeJobId = jobId
    const result = new Promise<string>((resolve, reject) => {
      this.active = { resolve, reject }
    })
    const request: VoiceWorkerRequest = { type: 'transcribe', jobId, audio }
    this.worker!.postMessage(request, [audio.buffer])
    return result.finally(() => {
      this.active = null
      this.activeJobId = null
      this.armIdleTimer()
    })
  }

  cancel(): void {
    const error = new Error('Voice transcription was cancelled.')
    this.readyReject?.(error)
    this.active?.reject(error)
    this.dispose()
  }

  dispose(): void {
    this.clearIdleTimer()
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    this.readyResolve = null
    this.readyReject = null
    this.initJobId = null
    this.active = null
    this.activeJobId = null
  }

  private ensureReady(): Promise<void> {
    if (this.ready) return this.ready
    const worker = this.createWorker()
    this.worker = worker
    worker.addEventListener('message', (event: MessageEvent<VoiceWorkerReply>) => this.receive(event.data))
    worker.addEventListener('error', () => this.fail(new Error('The local voice worker could not start.')))
    const jobId = crypto.randomUUID()
    this.initJobId = jobId
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    const request: VoiceWorkerRequest = { type: 'init', jobId }
    worker.postMessage(request)
    return this.ready
  }

  private receive(reply: VoiceWorkerReply): void {
    if (reply.type === 'ready') {
      if (reply.jobId !== this.initJobId) return
      this.readyResolve?.()
      this.readyResolve = null
      this.readyReject = null
      this.initJobId = null
      return
    }
    if (reply.type === 'progress') return
    if (reply.type === 'error' && reply.jobId === this.initJobId) {
      this.fail(new Error(reply.message))
      return
    }
    if (reply.jobId !== this.activeJobId) return
    if (reply.type === 'result') this.active?.resolve(reply.text.trim())
    else this.active?.reject(new Error(reply.message))
  }

  private fail(error: Error): void {
    this.readyReject?.(error)
    this.active?.reject(error)
    this.dispose()
  }

  private armIdleTimer(): void {
    this.idleTimer = setTimeout(() => this.dispose(), IDLE_TIMEOUT_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}
