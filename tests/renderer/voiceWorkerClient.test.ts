import { describe, expect, test, vi } from 'vitest'
import type { VoiceWorkerReply, VoiceWorkerRequest } from '@shared/voice'
import { VoiceWorkerClient } from '@/chat/voice/workerClient'

class FakeWorker extends EventTarget {
  readonly requests: VoiceWorkerRequest[] = []
  terminated = false

  postMessage(request: VoiceWorkerRequest): void {
    this.requests.push(request)
    queueMicrotask(() => {
      const reply: VoiceWorkerReply = request.type === 'init'
        ? { type: 'ready', jobId: request.jobId }
        : { type: 'result', jobId: request.jobId, text: ' local words ' }
      this.dispatchEvent(new MessageEvent('message', { data: reply }))
    })
  }

  terminate(): void {
    this.terminated = true
  }
}

describe('VoiceWorkerClient', () => {
  test('initialises once and transfers final reviewed text', async () => {
    const fake = new FakeWorker()
    const client = new VoiceWorkerClient(() => fake as unknown as Worker)

    await expect(client.transcribe(new Float32Array([0, 0.5]))).resolves.toBe('local words')
    expect(fake.requests.map((request) => request.type)).toEqual(['init', 'transcribe'])
  })

  test('hard cancellation terminates the worker and rejects the active job', async () => {
    const fake = new FakeWorker()
    fake.postMessage = vi.fn((request: VoiceWorkerRequest) => {
      fake.requests.push(request)
      if (request.type === 'init') {
        queueMicrotask(() => fake.dispatchEvent(new MessageEvent('message', {
          data: { type: 'ready', jobId: request.jobId } satisfies VoiceWorkerReply,
        })))
      }
    })
    const client = new VoiceWorkerClient(() => fake as unknown as Worker)
    const result = client.transcribe(new Float32Array([0]))
    await vi.waitFor(() => expect(fake.requests.at(-1)?.type).toBe('transcribe'))
    client.cancel()

    await expect(result).rejects.toThrow('cancelled')
    expect(fake.terminated).toBe(true)
  })
})
