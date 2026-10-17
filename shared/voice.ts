export type VoiceEngine = 'apple' | 'transformers' | 'off'

export type VoiceModelState = 'missing' | 'downloading' | 'ready' | 'corrupt'

export interface VoiceModelStatus {
  state: VoiceModelState
  modelId: string
  revision: string
  bytesDownloaded: number
  bytesTotal: number
  error?: string
}

export interface VoiceStatus {
  engine: VoiceEngine
  available: boolean
  reason?: string
  model?: VoiceModelStatus
}

export interface VoiceModelProgress {
  modelId: string
  file: string
  bytesDownloaded: number
  bytesTotal: number
}

export type VoiceWorkerRequest =
  | { type: 'init'; jobId: string }
  | { type: 'transcribe'; jobId: string; audio: Float32Array }

export type VoiceWorkerReply =
  | { type: 'ready'; jobId: string }
  | { type: 'progress'; jobId: string; progress: number; file?: string }
  | { type: 'result'; jobId: string; text: string }
  | { type: 'error'; jobId: string; code: VoiceErrorCode; message: string }

export type VoiceErrorCode =
  | 'cancelled'
  | 'decode-failed'
  | 'inference-failed'
  | 'microphone-denied'
  | 'microphone-missing'
  | 'model-corrupt'
  | 'model-missing'
  | 'out-of-memory'
  | 'recording-too-long'
  | 'unsupported-recorder'
