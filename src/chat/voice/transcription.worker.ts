/// <reference lib="webworker" />

import { env, pipeline } from '@huggingface/transformers'
import type { VoiceWorkerReply, VoiceWorkerRequest } from '@shared/voice'

const MODEL_ID = 'onnx-community/whisper-tiny.en'

type TranscriptionOutput = { text: string } | { text: string }[]
type Transcriber = (audio: Float32Array) => Promise<TranscriptionOutput>
let transcriber: Transcriber | null = null

self.addEventListener('message', (event: MessageEvent<VoiceWorkerRequest>) => {
  void handle(event.data)
})

async function handle(request: VoiceWorkerRequest): Promise<void> {
  try {
    if (request.type === 'init') {
      env.allowRemoteModels = false
      env.allowLocalModels = true
      env.localModelPath = 'roster-model://voice/'
      env.useBrowserCache = false
      const wasm = env.backends.onnx.wasm
      if (!wasm) throw new Error('The local WebAssembly runtime is unavailable.')
      wasm.numThreads = 1
      wasm.proxy = false
      // Transformers.js installs a CDN default during module evaluation. Clear
      // it so ONNX Runtime uses the WASM URL Vite emitted beside this worker.
      wasm.wasmPaths = undefined
      const createPipeline = pipeline as unknown as (
        task: 'automatic-speech-recognition',
        model: string,
        options: Record<string, unknown>,
      ) => Promise<Transcriber>
      transcriber = await createPipeline('automatic-speech-recognition', MODEL_ID, {
        device: 'wasm',
        dtype: 'q8',
        local_files_only: true,
        progress_callback: (progress: { status: string; progress?: number; file?: string }) => {
          if (progress.status !== 'progress') return
          post({
            type: 'progress',
            jobId: request.jobId,
            progress: progress.progress ?? 0,
            file: progress.file,
          })
        },
      })
      post({ type: 'ready', jobId: request.jobId })
      return
    }

    if (!transcriber) throw new Error('The local voice model is not loaded.')
    const output = await transcriber(request.audio)
    const text = Array.isArray(output) ? output.map((item) => item.text).join(' ') : output.text
    post({ type: 'result', jobId: request.jobId, text })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const code = /memory|allocation/i.test(message) ? 'out-of-memory' : 'inference-failed'
    post({ type: 'error', jobId: request.jobId, code, message: friendlyMessage(message) })
  }
}
function friendlyMessage(message: string): string {
  if (/memory|allocation/i.test(message)) return 'There is not enough memory to run local voice transcription.'
  if (/locate file|404|not loaded/i.test(message)) return 'The local voice model is missing or incomplete.'
  return 'Local voice transcription failed.'
}

function post(reply: VoiceWorkerReply): void {
  self.postMessage(reply)
}
