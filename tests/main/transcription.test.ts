import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, test, vi } from 'vitest'
import { MacSpeechTranscriber } from '@main/voice/transcription'

function helper(): { process: ChildProcessWithoutNullStreams; output: PassThrough } {
  const output = new PassThrough()
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: output,
    stderr: new PassThrough(),
  }) as unknown as ChildProcessWithoutNullStreams
  return { process, output }
}

describe('MacSpeechTranscriber', () => {
  test('starts the bundled helper and returns its final reviewed text', async () => {
    const child = helper()
    const spawn = vi.fn(() => child.process)
    const client = new MacSpeechTranscriber('darwin', spawn, () => process.execPath)
    await client.start()
    const result = client.stop()
    child.output.write('{"type":"result","text":" Find the leak. "}\n')
    await expect(result).resolves.toEqual({ text: 'Find the leak.' })
    expect(spawn).toHaveBeenCalledWith(process.execPath)
  })

  test('does not offer an OpenAI or browser fallback on other platforms', async () => {
    await expect(new MacSpeechTranscriber('win32').start()).rejects.toThrow('macOS only')
  })

  test('reports an absent packaged helper clearly', async () => {
    const client = new MacSpeechTranscriber('darwin', vi.fn(), () => '/missing/roster-voice')
    await expect(client.start()).rejects.toThrow('helper is missing')
  })
})
