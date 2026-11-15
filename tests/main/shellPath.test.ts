import { describe, expect, test } from 'vitest'
import { loginShellPath, mergePath } from '@main/auth/shellPath'

describe('loginShellPath', () => {
  test('reads the PATH the login shell printed, ignoring whatever its rc files said', () => {
    const output = 'Welcome to zsh\nnvm: ready\n\u0001PATH\u0001/Users/me/.nvm/bin:/usr/bin\u0001PATH\u0001\n'
    expect(loginShellPath(output)).toBe('/Users/me/.nvm/bin:/usr/bin')
  })

  test('returns null when the shell printed no PATH', () => {
    expect(loginShellPath('just noise')).toBeNull()
  })
})

describe('mergePath', () => {
  test('puts the login shell first, then what was inherited, then the usual install dirs', () => {
    expect(mergePath('/nvm/bin:/usr/bin', '/usr/bin:/bin', ['/opt/homebrew/bin'])).toBe(
      '/nvm/bin:/usr/bin:/bin:/opt/homebrew/bin',
    )
  })

  test('keeps each directory once, and drops the bundled node_modules/.bin copies', () => {
    expect(
      mergePath('/a:/a:/proj/node_modules/.bin', '/a:/b', ['/b', '/c']),
    ).toBe('/a:/b:/c')
  })

  test('ignores an empty login PATH rather than emptying the inherited one', () => {
    expect(mergePath('', '/usr/bin', [])).toBe('/usr/bin')
  })
})
