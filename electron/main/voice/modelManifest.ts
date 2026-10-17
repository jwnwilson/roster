export interface VoiceModelFile {
  path: string
  bytes: number
  sha256: string
}

export interface VoiceModelManifest {
  schemaVersion: 1
  modelId: string
  revision: string
  dtype: 'q8'
  runtime: 'onnx-wasm'
  license: string
  files: readonly VoiceModelFile[]
}

/** Immutable, reviewed inputs. Never replace the revision with `main`. */
export const VOICE_MODEL: VoiceModelManifest = {
  schemaVersion: 1,
  modelId: 'onnx-community/whisper-tiny.en',
  revision: '2575352d61be1bf7225cf8f8b268a4678025fc58',
  dtype: 'q8',
  runtime: 'onnx-wasm',
  license: 'MIT',
  files: [
    { path: 'config.json', bytes: 2_197, sha256: '251ea843b5901a99efa58c0b99b8052c6019aa3e7d2baf46693a1128ff606233' },
    { path: 'generation_config.json', bytes: 1_646, sha256: '7b2e8451ed5f118e75fdd991409d72119d21d2fef1eba9723f68fb9c57fe5dc9' },
    { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 30_718_858, sha256: 'c0592d0749413c960569e1c7fb806b060d5d18f3ebad4a95cbf9a77dc6e9be52' },
    { path: 'onnx/encoder_model_quantized.onnx', bytes: 10_124_993, sha256: 'e93ec822f16a8fd264e7de972ad17d615ea7334b75a52d54c50c2e18dd503a25' },
    { path: 'preprocessor_config.json', bytes: 339, sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
    { path: 'tokenizer.json', bytes: 2_405_679, sha256: '5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0' },
    { path: 'tokenizer_config.json', bytes: 282_662, sha256: '93879c3dccdd4b976f709acd85b44778873f30c275e67026f30ca1e4c975230c' },
  ],
}

export const VOICE_MODEL_BYTES = VOICE_MODEL.files.reduce((total, file) => total + file.bytes, 0)
