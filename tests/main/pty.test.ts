import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { PtyManager } from '@main/pty/manager'

let dir: string
let manager: PtyManager

const SIZE = { cols: 80, rows: 24 }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'roster-pty-'))
  manager = new PtyManager()
})

afterEach(async () => {
  manager.disposeAll()
  await rm(dir, { recursive: true, force: true })
})

/** Resolves once the pty has emitted output matching the pattern. */
function waitForOutput(sessionId: string, pattern: RegExp, timeoutMs = 8_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let seen = ''
    const stop = manager.onData((id, data) => {
      if (id !== sessionId) return
      seen += data
      if (pattern.test(seen)) {
        stop()
        clearTimeout(timer)
        resolve(seen)
      }
    })
    const timer = setTimeout(() => {
      stop()
      reject(new Error(`timed out waiting for ${pattern}; saw: ${seen.slice(-200)}`))
    }, timeoutMs)
  })
}

describe('PtyManager', () => {
  test('opens a shell in the requested directory', async () => {
    const info = manager.open('s1', dir, SIZE)

    expect(info.cwd).toBe(dir)
    expect(info.shell).not.toBe('')
    expect(manager.isOpen('s1')).toBe(true)
  })

  test('runs a command and streams its output back', async () => {
    manager.open('s1', dir, SIZE)
    const output = waitForOutput('s1', /pty-is-alive/)

    manager.write('s1', 'echo pty-is-alive\n')

    await expect(output).resolves.toMatch(/pty-is-alive/)
  }, 15_000)

  test('opening the same session twice reuses the pty', () => {
    const first = manager.open('s1', dir, SIZE)
    const second = manager.open('s1', '/somewhere/else', SIZE)

    // A second open must not silently start a new shell and lose scrollback.
    expect(second.cwd).toBe(first.cwd)
  })

  test('keeps sessions separate', async () => {
    manager.open('a', dir, SIZE)
    manager.open('b', dir, SIZE)

    const onlyA = waitForOutput('a', /from-a/)
    manager.write('a', 'echo from-a\n')

    await expect(onlyA).resolves.toMatch(/from-a/)
    expect(manager.isOpen('b')).toBe(true)
  }, 15_000)

  test('writing to a session that was never opened is a no-op', () => {
    expect(() => manager.write('ghost', 'echo hi\n')).not.toThrow()
  })

  test('closing disposes the pty', () => {
    manager.open('s1', dir, SIZE)
    manager.close('s1')

    expect(manager.isOpen('s1')).toBe(false)
  })

  test('closing an unopened session is a no-op', () => {
    expect(() => manager.close('ghost')).not.toThrow()
  })

  test('notifies listeners when the shell exits', async () => {
    manager.open('s1', dir, SIZE)

    const exited = new Promise<number>((resolve) => {
      manager.onExit((id) => {
        if (id === 's1') resolve(0)
      })
    })
    manager.write('s1', 'exit\n')

    await expect(exited).resolves.toBe(0)
    expect(manager.isOpen('s1')).toBe(false)
  }, 15_000)

  test('resizes an open pty', () => {
    manager.open('s1', dir, SIZE)
    expect(() => manager.resize('s1', { cols: 120, rows: 40 })).not.toThrow()
  })

  test('ignores a zero-sized resize, which would kill the pty', () => {
    manager.open('s1', dir, SIZE)

    // Happens while the pane is hidden and has no layout.
    manager.resize('s1', { cols: 0, rows: 0 })

    expect(manager.isOpen('s1')).toBe(true)
  })

  test('disposeAll closes every session', () => {
    manager.open('a', dir, SIZE)
    manager.open('b', dir, SIZE)

    manager.disposeAll()

    expect(manager.isOpen('a')).toBe(false)
    expect(manager.isOpen('b')).toBe(false)
  })

  test('unsubscribing stops delivery', async () => {
    manager.open('s1', dir, SIZE)
    let calls = 0
    const stop = manager.onData(() => {
      calls += 1
    })
    stop()

    manager.write('s1', 'echo quiet\n')
    await new Promise((r) => setTimeout(r, 800))

    expect(calls).toBe(0)
  }, 15_000)
})

describe('PtyManager — scrollback', () => {
  test('a freshly opened session has no history', () => {
    expect(manager.open('s1', dir, SIZE).history).toBe('')
  })

  test('reopening returns what the shell has printed', async () => {
    manager.open('s1', dir, SIZE)
    manager.write('s1', 'echo history-is-kept\n')
    await waitForOutput('s1', /history-is-kept/)

    // Navigating away disposes the pane, not the pty; reopening replays.
    const reopened = manager.open('s1', dir, SIZE)
    expect(reopened.history).toMatch(/history-is-kept/)
  }, 15_000)

  test('history is readable without reopening', async () => {
    manager.open('s1', dir, SIZE)
    manager.write('s1', 'echo readable-history\n')
    await waitForOutput('s1', /readable-history/)

    expect(manager.history('s1')).toMatch(/readable-history/)
  }, 15_000)

  test('a session that was never opened has no history', () => {
    expect(manager.history('ghost')).toBe('')
  })

  test('closing a session forgets its history', async () => {
    manager.open('s1', dir, SIZE)
    manager.write('s1', 'echo forgotten\n')
    await waitForOutput('s1', /forgotten/)
    manager.close('s1')

    expect(manager.history('s1')).toBe('')
  }, 15_000)

  test('keeps sessions histories apart', async () => {
    manager.open('a', dir, SIZE)
    manager.open('b', dir, SIZE)
    manager.write('a', 'echo only-in-a\n')
    await waitForOutput('a', /only-in-a/)

    expect(manager.history('b')).not.toMatch(/only-in-a/)
  }, 15_000)
})
