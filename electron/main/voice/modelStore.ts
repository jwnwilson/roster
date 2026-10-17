import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, normalize, relative, sep } from 'node:path'
import type { VoiceModelProgress, VoiceModelStatus } from '../../../shared/voice'
import { VOICE_MODEL, type VoiceModelFile, type VoiceModelManifest } from './modelManifest'

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

function modelUrl(file: VoiceModelFile, manifest = VOICE_MODEL): string {
  const encoded = file.path.split('/').map(encodeURIComponent).join('/')
  return `https://huggingface.co/${manifest.modelId}/resolve/${manifest.revision}/${encoded}`
}

export class VoiceModelStore {
  private controller: AbortController | null = null
  private activeDownload: Promise<VoiceModelStatus> | null = null
  private readonly listeners = new Set<(progress: VoiceModelProgress) => void>()
  private verified = false

  constructor(
    private readonly root: string,
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
    private readonly manifest: VoiceModelManifest = VOICE_MODEL,
  ) {}

  private get bytesTotal(): number {
    return this.manifest.files.reduce((total, file) => total + file.bytes, 0)
  }

  onProgress(listener: (progress: VoiceModelProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async status(): Promise<VoiceModelStatus> {
    if (this.controller) return this.modelStatus('downloading')
    if (this.verified) return this.modelStatus('ready', this.bytesTotal)

    for (const file of this.manifest.files) {
      const target = this.filePath(file.path)
      try {
        if (!(await verifyFile(target, file))) return this.modelStatus('corrupt')
      } catch (cause) {
        const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
        return this.modelStatus(code === 'ENOENT' ? 'missing' : 'corrupt')
      }
    }
    this.verified = true
    return this.modelStatus('ready', this.bytesTotal)
  }

  async download(): Promise<VoiceModelStatus> {
    if (this.activeDownload) throw new Error('The voice model is already downloading.')
    if ((await this.status()).state === 'ready') return this.modelStatus('ready', this.bytesTotal)

    const controller = new AbortController()
    this.controller = controller
    this.verified = false
    const download = this.performDownload(controller)
    this.activeDownload = download

    try {
      return await download
    } finally {
      this.activeDownload = null
      this.controller = null
    }
  }

  private async performDownload(controller: AbortController): Promise<VoiceModelStatus> {
    let completed = 0

    try {
      for (const file of this.manifest.files) {
        const target = this.filePath(file.path)
        if (await verifyFile(target, file).catch(() => false)) {
          completed += file.bytes
          continue
        }
        await this.downloadFile(file, target, completed, controller.signal)
        completed += file.bytes
      }
      this.verified = true
      return this.modelStatus('ready', this.bytesTotal)
    } catch (cause) {
      if (controller.signal.aborted) throw new Error('Voice model download was cancelled.')
      throw cause
    }
  }

  cancelDownload(): void {
    this.controller?.abort()
  }

  async delete(): Promise<void> {
    this.cancelDownload()
    await this.activeDownload?.catch(() => undefined)
    this.verified = false
    await rm(this.modelRoot(), { recursive: true, force: true })
  }

  /** Resolves only allowlisted files after the complete model has verified. */
  async fileForUrl(rawUrl: string): Promise<string | null> {
    if ((await this.status()).state !== 'ready') return null
    const url = new URL(rawUrl)
    if (url.protocol !== 'roster-model:' || url.hostname !== 'voice') return null
    const prefix = `/${this.manifest.modelId}/`
    if (!url.pathname.startsWith(prefix)) return null
    const requested = decodeURIComponent(url.pathname.slice(prefix.length))
    if (!this.manifest.files.some((file) => file.path === requested)) return null
    return this.filePath(requested)
  }

  private async downloadFile(
    file: VoiceModelFile,
    target: string,
    completed: number,
    signal: AbortSignal,
  ): Promise<void> {
    await mkdir(dirname(target), { recursive: true })
    const partial = `${target}.partial`
    await rm(partial, { force: true })
    const response = await this.fetcher(modelUrl(file, this.manifest), { signal })
    if (!response.ok || !response.body) {
      throw new Error(`Voice model download failed for ${file.path} (${response.status}).`)
    }

    const contentLength = response.headers.get('content-length')
    const declared = contentLength === null ? null : Number(contentLength)
    if (declared !== null && Number.isFinite(declared) && declared !== file.bytes) {
      throw new Error(`Voice model size did not match the manifest for ${file.path}.`)
    }

    const handle = await open(partial, 'wx')
    const hash = createHash('sha256')
    let received = 0
    try {
      try {
        const reader = response.body.getReader()
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          signal.throwIfAborted()
          received += chunk.value.byteLength
          if (received > file.bytes) throw new Error(`Voice model file ${file.path} exceeded its manifest size.`)
          hash.update(chunk.value)
          await handle.write(chunk.value)
          this.emit(file.path, completed + received)
        }
      } finally {
        await handle.close()
      }

      if (received !== file.bytes || hash.digest('hex') !== file.sha256) {
        throw new Error(`Voice model integrity check failed for ${file.path}.`)
      }
      await rm(target, { force: true })
      await rename(partial, target)
    } catch (cause) {
      await rm(partial, { force: true })
      throw cause
    }
  }

  private emit(file: string, bytesDownloaded: number): void {
    const progress = { modelId: this.manifest.modelId, file, bytesDownloaded, bytesTotal: this.bytesTotal }
    for (const listener of this.listeners) listener(progress)
  }

  private modelStatus(state: VoiceModelStatus['state'], bytesDownloaded = 0): VoiceModelStatus {
    return {
      state,
      modelId: this.manifest.modelId,
      revision: this.manifest.revision,
      bytesDownloaded,
      bytesTotal: this.bytesTotal,
    }
  }

  private modelRoot(): string {
    return join(this.root, ...this.manifest.modelId.split('/'), this.manifest.revision)
  }

  private filePath(file: string): string {
    const root = this.modelRoot()
    const target = normalize(join(root, file))
    const within = relative(root, target)
    if (within.startsWith(`..${sep}`) || within === '..' || within.includes(`..${sep}`)) {
      throw new Error('Voice model path escaped its cache directory.')
    }
    return target
  }
}

async function verifyFile(path: string, expected: VoiceModelFile): Promise<boolean> {
  if ((await stat(path)).size !== expected.bytes) return false
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex') === expected.sha256
}

export { modelUrl }
