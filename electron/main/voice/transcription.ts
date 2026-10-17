import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { TranscriptionResult } from '../../../shared/ipc'

interface HelperReply {
  type: 'result' | 'error'
  text?: string
  message?: string
}

interface ActiveDictation {
  child: ChildProcessWithoutNullStreams
  result: Promise<TranscriptionResult>
}

/** Runs the bundled macOS Speech helper; audio never crosses Electron IPC. */
export class MacSpeechTranscriber {
  private active: ActiveDictation | null = null

  constructor(
    private readonly platform = process.platform,
    private readonly spawnHelper: (path: string) => ChildProcessWithoutNullStreams = (path) =>
      spawn(path, ['--stdio'], { stdio: 'pipe' }),
    private readonly helperPath = defaultHelperPath,
  ) {}

  async start(): Promise<void> {
    if (this.platform !== 'darwin') throw new Error('Voice dictation is currently available on macOS only.')
    if (this.active) throw new Error('Voice dictation is already recording.')
    const path = this.helperPath()
    if (!existsSync(path)) throw new Error('Voice dictation is unavailable because its macOS helper is missing.')
    const child = this.spawnHelper(path)
    this.active = { child, result: replyFrom(child) }
    child.stdin.write('{"command":"start"}\n')
  }

  async stop(): Promise<TranscriptionResult> {
    const active = this.active
    if (!active) throw new Error('Voice dictation is not recording.')
    this.active = null
    active.child.stdin.write('{"command":"stop"}\n')
    return active.result
  }
}

export function voiceHelperPath(
  isPackaged = process.defaultApp !== true,
  resourcesPath = process.resourcesPath,
  cwd = process.cwd(),
): string {
  return isPackaged
    ? join(resourcesPath, 'voice', 'roster-voice')
    : join(cwd, 'build', 'voice', 'roster-voice')
}

const defaultHelperPath = (): string => voiceHelperPath()

function replyFrom(child: ChildProcessWithoutNullStreams): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    let output = ''
    let error = ''
    let settled = false
    const fail = (message: string): void => {
      if (settled) return
      settled = true
      reject(new Error(message))
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      output += chunk
      const newline = output.indexOf('\n')
      if (newline === -1 || settled) return
      try {
        const reply = JSON.parse(output.slice(0, newline)) as HelperReply
        if (reply.type === 'result' && typeof reply.text === 'string') {
          settled = true
          resolve({ text: reply.text.trim() })
        } else fail(reply.message ?? 'Voice dictation did not return text.')
      } catch { fail('Voice dictation returned an invalid response.') }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { error += chunk })
    child.on('error', () => fail('Roster could not start the macOS voice dictation helper.'))
    child.on('close', () => fail(error.trim() || 'Voice dictation ended before it returned text.'))
  })
}
