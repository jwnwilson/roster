import { expect, test, vi } from 'vitest'

const { transcribe, pipeline, env } = vi.hoisted(() => {
  const transcribe = vi.fn().mockResolvedValue({ text: 'complete recording' })
  return {
    transcribe,
    pipeline: vi.fn().mockResolvedValue(transcribe),
    env: { backends: { onnx: { wasm: {} } } },
  }
})
vi.mock('@huggingface/transformers', () => ({ env, pipeline }))

test('runs local WASM inference with overlapping chunks for the entire 60-second recording', async () => {
  const post = vi.spyOn(self, 'postMessage').mockImplementation(() => undefined)
  await import('@/chat/voice/transcription.worker')
  self.dispatchEvent(new MessageEvent('message', { data: { type: 'init', jobId: 'init' } }))
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'ready', jobId: 'init' }))
  const audio = new Float32Array(16_000 * 60)
  for (let i = 0; i < audio.length; i++) audio[i] = 0.1 * Math.sin(i * 0.1)
  self.dispatchEvent(new MessageEvent('message', { data: { type: 'transcribe', jobId: 'clip', audio } }))
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith({
    type: 'result', jobId: 'clip', text: 'complete recording',
  }))
  expect(transcribe).toHaveBeenCalledWith(audio, { chunk_length_s: 30, stride_length_s: 5 })
  expect(pipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'onnx-community/whisper-tiny.en',
    expect.objectContaining({ device: 'wasm', dtype: 'q8', local_files_only: true }))
  expect(env).toMatchObject({ allowRemoteModels: false, localModelPath: 'roster-model://voice/' })
  transcribe.mockClear()
  self.dispatchEvent(new MessageEvent('message', {
    data: { type: 'transcribe', jobId: 'silence', audio: new Float32Array(16_000) },
  }))
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({
    type: 'error', jobId: 'silence', code: 'no-signal',
  })))
  expect(transcribe).not.toHaveBeenCalled()

  self.dispatchEvent(new MessageEvent('message', {
    data: { type: 'transcribe', jobId: 'invalid', audio: new Float32Array([NaN]) },
  }))
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({
    type: 'error', jobId: 'invalid', code: 'decode-failed',
  })))
  expect(transcribe).not.toHaveBeenCalled()

  // Never blacklist a common word: a genuine recording of "you" is valid.
  transcribe.mockResolvedValueOnce({ text: ' you ' })
  self.dispatchEvent(new MessageEvent('message', { data: { type: 'transcribe', jobId: 'you', audio } }))
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith({ type: 'result', jobId: 'you', text: ' you ' }))
  post.mockRestore()
})
