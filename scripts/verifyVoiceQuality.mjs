// Opt-in real-model regression. No downloads, microphone access, or saved audio.
// Node 22+: node --experimental-strip-types scripts/verifyVoiceQuality.mjs MODEL_REVISION_DIR JFK_WAV
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VOICE_MODEL } from '../electron/main/voice/modelManifest.ts'
import { inspectVoiceSignal } from '../src/chat/voice/signal.ts'

const [modelPath, fixturePath] = process.argv.slice(2)
assert(modelPath && fixturePath, 'Provide the verified model revision directory and whisper.cpp samples/jfk.wav.')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
for (const file of VOICE_MODEL.files) {
  const bytes = await readFile(join(modelPath, file.path))
  assert.equal(bytes.length, file.bytes, `Unexpected model size: ${file.path}`)
  assert.equal(hash(bytes), file.sha256, `Unexpected model hash: ${file.path}`)
}
const wav = await readFile(fixturePath)
// Public JFK speech fixture from ggml-org/whisper.cpp, not user recordings.
assert.equal(hash(wav), '59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e', 'Unexpected speech fixture')
assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
let pcm
let formatChecked = false
for (let offset = 12; offset + 8 <= wav.length;) {
  const size = wav.readUInt32LE(offset + 4)
  assert(offset + 8 + size <= wav.length, 'Truncated WAV')
  const chunk = wav.toString('ascii', offset, offset + 4)
  if (chunk === 'fmt ') {
    assert.equal(wav.readUInt16LE(offset + 8), 1) // PCM
    assert.equal(wav.readUInt16LE(offset + 10), 1) // mono
    assert.equal(wav.readUInt32LE(offset + 12), 16_000)
    assert.equal(wav.readUInt16LE(offset + 22), 16)
    formatChecked = true
  }
  if (chunk === 'data') pcm = wav.subarray(offset + 8, offset + 8 + size)
  offset += 8 + size + size % 2
}
assert(formatChecked && pcm && pcm.length % 2 === 0, 'Expected mono PCM16 WAV')
const speech = Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768)

// Inject ONNX Runtime Web before Transformers loads: this must exercise WASM,
// not silently use Transformers' native Node runtime. Electron capture/CSP
// and the browser JSEP runtime variant still require separate device checks.
const ort = await import('onnxruntime-web')
globalThis[Symbol.for('onnxruntime')] = ort
const { pipeline, env } = await import('@huggingface/transformers')
env.allowRemoteModels = false
env.allowLocalModels = true
env.useBrowserCache = false
env.backends.onnx.wasm.numThreads = 1
env.backends.onnx.wasm.proxy = false
env.backends.onnx.wasm.wasmPaths = `${dirname(fileURLToPath(import.meta.resolve('onnxruntime-web')))}/`
const transcribe = await pipeline('automatic-speech-recognition', resolve(modelPath), {
  device: 'auto', dtype: 'q8', local_files_only: true,
  session_options: { executionProviders: ['wasm'] },
})
try {
  const options = { chunk_length_s: 30, stride_length_s: 5 }
  const silence = new Float32Array(48_000)
  const raw = await transcribe(silence, options)
  // Diagnostic only: do not depend on the precise hallucinated word.
  console.log(`Raw silence produces text: ${Boolean(raw.text.trim())}`)
  assert.equal(inspectVoiceSignal(silence).usable, false)
  let seed = 1
  const noise = Float32Array.from({ length: 48_000 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return (seed / 4294967296 - 0.5) * 0.0001
  })
  assert.equal(inspectVoiceSignal(noise).usable, false)
  for (const [name, audio] of [['speech', speech], ['quiet speech', speech.map((x) => x * 0.001)]]) {
    assert.equal(inspectVoiceSignal(audio).usable, true, `${name} must not be rejected`)
    const result = await transcribe(audio, options)
    const normalized = result.text.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ')
    assert(normalized.includes('ask not what your country can do for you'), `${name}: known speech did not transcribe correctly`)
    console.log(`${name}: signal guard and real WASM transcription passed`)
  }
  console.log('Voice quality regression passed (Node WASM; not a microphone/Electron acceptance test).')
} finally {
  await transcribe.dispose()
}
