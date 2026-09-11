import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'

/**
 * The rule behind `build/afterPack.cjs`, which fails a build whose bundled CLI
 * binaries are for a different CPU than the app.
 *
 * Loaded through `createRequire` rather than imported: the hook is plain
 * CommonJS because electron-builder requires it directly, and it sits outside
 * the tsconfig that covers this suite.
 */
const require_ = createRequire(import.meta.url)
const { wrongArchPackages } = require_('../../build/afterPack.cjs') as {
  wrongArchPackages: (names: readonly string[], targetArch: string) => string[]
}

describe('wrongArchPackages', () => {
  test('passes a bundle whose binaries match the arch being built', () => {
    const names = ['claude-agent-sdk-darwin-arm64', 'codex-darwin-arm64', 'better-sqlite3']

    expect(wrongArchPackages(names, 'arm64')).toEqual([])
  })

  test('catches the mismatch that shipped in v0.1.28', () => {
    // An arm64 app packaged on an Intel machine: the app runs, and every agent
    // fails at its first turn with "Native CLI binary for darwin-arm64 not
    // found". Nothing else in the build notices.
    const names = ['claude-agent-sdk-darwin-x64', 'codex-darwin-x64', 'node-pty']

    expect(wrongArchPackages(names, 'arm64')).toEqual([
      'claude-agent-sdk-darwin-x64',
      'codex-darwin-x64',
    ])
  })

  test('catches it in the other direction too', () => {
    expect(wrongArchPackages(['claude-agent-sdk-darwin-arm64'], 'x64')).toEqual([
      'claude-agent-sdk-darwin-arm64',
    ])
  })

  test('ignores packages that name no platform at all', () => {
    const names = ['react', 'better-sqlite3', 'node-pty', 'zod']

    expect(wrongArchPackages(names, 'arm64')).toEqual([])
  })

  test('does not mistake a version or a word ending in the arch for a platform package', () => {
    // `-arm64` alone is not the pattern; a platform segment has to precede it,
    // or an ordinary dependency could fail a build for its name.
    const names = ['some-x64', 'arm64', 'darwin', 'linux-headers']

    expect(wrongArchPackages(names, 'arm64')).toEqual([])
  })

  test('reads the libc suffix Linux packages carry', () => {
    expect(wrongArchPackages(['claude-agent-sdk-linux-x64-musl'], 'arm64')).toEqual([
      'claude-agent-sdk-linux-x64-musl',
    ])
    expect(wrongArchPackages(['claude-agent-sdk-linux-arm64-musl'], 'arm64')).toEqual([])
  })

  test('allows both architectures in a universal build', () => {
    // A universal app is meant to carry each one, so the rule does not apply.
    const names = ['claude-agent-sdk-darwin-arm64', 'claude-agent-sdk-darwin-x64']

    expect(wrongArchPackages(names, 'universal')).toEqual([])
  })

  test('judges each package on its own, not on what sits beside it', () => {
    const names = ['claude-agent-sdk-darwin-arm64', 'codex-darwin-x64']

    expect(wrongArchPackages(names, 'arm64')).toEqual(['codex-darwin-x64'])
  })
})
