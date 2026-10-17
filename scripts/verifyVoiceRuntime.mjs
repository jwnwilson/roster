import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const assets = await readdir(join('out', 'renderer', 'assets'))
if (!assets.some((name) => name.startsWith('transcription.worker-') && name.endsWith('.js'))) {
  throw new Error('voice transcription worker is absent from the renderer build')
}
const wasmName = assets.find((name) => name.startsWith('ort-wasm-simd-threaded.jsep-') && name.endsWith('.wasm'))
if (!wasmName) throw new Error('voice ONNX WASM runtime is absent from the renderer build')
const source = await readFile(join('node_modules', '@huggingface', 'transformers', 'dist', 'ort-wasm-simd-threaded.jsep.wasm'))
const packaged = await readFile(join('out', 'renderer', 'assets', wasmName))
if (hash(source) !== hash(packaged)) throw new Error('voice ONNX WASM runtime differs from the pinned dependency')

process.stdout.write('voice runtime assets verified\n')

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}
