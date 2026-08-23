import { describe, expect, test } from 'vitest'
import { messageFor } from '@/lib/errors'

describe('messageFor', () => {
  test('strips the IPC wrapper, which names plumbing the reader cannot act on', () => {
    const wrapped = new Error(
      `Error invoking remote method 'skills:createFile': Error: "../escaped.md" would land outside the skill`,
    )

    expect(messageFor(wrapped)).toBe('"../escaped.md" would land outside the skill')
  })

  test('strips a bare error-class prefix', () => {
    expect(messageFor(new Error('Error: EACCES: permission denied'))).toBe(
      'EACCES: permission denied',
    )
  })

  test('leaves an already-clean message alone', () => {
    expect(messageFor(new Error('a name is required'))).toBe('a name is required')
  })

  test('handles something thrown that is not an Error', () => {
    expect(messageFor('just a string')).toBe('just a string')
    expect(messageFor(42)).toBe('42')
  })

  test('does not strip a channel name from the middle of a message', () => {
    // Only the leading wrapper is noise; the rest is the real message.
    const message = new Error("could not reach 'skills:createFile' from the worker")
    expect(messageFor(message)).toBe("could not reach 'skills:createFile' from the worker")
  })
})
