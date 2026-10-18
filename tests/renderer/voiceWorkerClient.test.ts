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
  test('rejects overlapping requests while the model is still loading', async () => {
    const fake = new FakeWorker()
    fake.postMessage = vi.fn((request) => fake.requests.push(request))
    const client = new VoiceWorkerClient(() => fake as unknown as Worker)
    const first = client.transcribe(new Float32Array([0]))
    const rejected = expect(first).rejects.toThrow('cancelled')
    const second = client.transcribe(new Float32Array([0]))
    const overlap = expect(second).rejects.toThrow('already running')
    client.cancel()
    await rejected
    await overlap
  })

  test('a cancelled job cannot clear the replacement job during initialization', async () => {
    const workers = [new FakeWorker(), new FakeWorker()]
    for (const fake of workers) fake.postMessage = vi.fn((request) => fake.requests.push(request))
    let index = 0
    const client = new VoiceWorkerClient(() => workers[index++]! as unknown as Worker)
    const old = client.transcribe(new Float32Array([0]))
    const cancelled = expect(old).rejects.toThrow('cancelled')
    client.cancel()
    const replacement = client.transcribe(new Float32Array([0]))
    const replacementCancelled = expect(replacement).rejects.toThrow('cancelled')
    await cancelled
    const overlap = client.transcribe(new Float32Array([0]))
    const overlapRejected = expect(overlap).rejects.toThrow('already running')
    client.cancel()
    await replacementCancelled
    await overlapRejected
  })

  test('cancelled inference cannot clear a replacement and late old messages are ignored', async () => {
    const workers = [new FakeWorker(), new FakeWorker()]
    for (const fake of workers) fake.postMessage = vi.fn((request) => fake.requests.push(request))
    let index = 0
    const client = new VoiceWorkerClient(() => workers[index++]! as unknown as Worker)
    const first = client.transcribe(new Float32Array([0]))
    const cancelled = expect(first).rejects.toThrow('cancelled')
    const oldWorker = workers[0]!
    oldWorker.dispatchEvent(new MessageEvent('message', { data: {
      type: 'ready', jobId: oldWorker.requests[0]!.jobId,
    } }))
    await vi.waitFor(() => expect(oldWorker.requests).toHaveLength(2))
    client.cancel()
    const replacement = client.transcribe(new Float32Array([1]))
    const newWorker = workers[1]!
    newWorker.dispatchEvent(new MessageEvent('message', { data: {
      type: 'ready', jobId: newWorker.requests[0]!.jobId,
    } }))
    await cancelled
    await vi.waitFor(() => expect(newWorker.requests).toHaveLength(2))
    oldWorker.dispatchEvent(new MessageEvent('message', { data: {
      type: 'result', jobId: oldWorker.requests[1]!.jobId, text: 'stale',
    } }))
    oldWorker.dispatchEvent(new Event('error'))
    newWorker.dispatchEvent(new MessageEvent('message', { data: {
      type: 'result', jobId: newWorker.requests[1]!.jobId, text: 'replacement',
    } }))
    await expect(replacement).resolves.toBe('replacement')
    client.dispose()
  })

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
