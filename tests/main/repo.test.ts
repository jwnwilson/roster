import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { isGitRepository } from '@main/sessions/repo'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'roster-repo-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('is this a git repository', () => {
  test('a directory with .git in it is', async () => {
    await mkdir(join(root, '.git'))

    expect(isGitRepository(root)).toBe(true)
  })

  test('a directory inside one is too', async () => {
    await mkdir(join(root, '.git'))
    const nested = join(root, 'src', 'deep')
    await mkdir(nested, { recursive: true })

    expect(isGitRepository(nested)).toBe(true)
  })

  test('a worktree is, even though its .git is a file', async () => {
    // `git worktree add` writes a .git file pointing at the real gitdir.
    await writeFile(join(root, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n', 'utf8')

    expect(isGitRepository(root)).toBe(true)
  })

  test('a plain directory is not', () => {
    expect(isGitRepository(root)).toBe(false)
  })

  test('a directory that is not there is not', () => {
    expect(isGitRepository(join(root, 'gone'))).toBe(false)
  })

  test('nothing is not', () => {
    expect(isGitRepository('')).toBe(false)
  })
})
