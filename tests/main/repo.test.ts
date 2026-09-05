import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { gitMetadata, isGitRepository } from '@main/sessions/repo'

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

describe('git metadata paths', () => {
  test('an ordinary checkout keeps all metadata in its .git directory', async () => {
    const gitDir = join(root, '.git')
    await mkdir(gitDir)

    expect(gitMetadata(join(root, 'src'))).toEqual({
      root,
      gitDir,
      commonDir: gitDir,
    })
  })

  test('resolves a linked worktree gitdir and its shared commondir', async () => {
    const commonDir = join(root, 'main', '.git')
    const gitDir = join(commonDir, 'worktrees', 'feature')
    const worktree = join(root, 'feature')
    await mkdir(gitDir, { recursive: true })
    await mkdir(worktree)
    await writeFile(join(worktree, '.git'), `gitdir: ${gitDir}\n`, 'utf8')
    await writeFile(join(gitDir, 'commondir'), '../..\n', 'utf8')

    expect(gitMetadata(worktree)).toEqual({ root: worktree, gitDir, commonDir })
  })

  test('resolves a relative gitdir pointer from the checkout root', async () => {
    const worktree = join(root, 'nested', 'feature')
    const gitDir = join(root, 'metadata', 'feature')
    await mkdir(worktree, { recursive: true })
    await mkdir(gitDir, { recursive: true })
    const relative = join('..', '..', 'metadata', 'feature')
    await writeFile(join(worktree, '.git'), `gitdir: ${relative}\n`, 'utf8')

    expect(gitMetadata(worktree)?.gitDir).toBe(resolve(worktree, relative))
  })

  test('rejects a malformed gitdir pointer', async () => {
    await writeFile(join(root, '.git'), 'not a gitdir\n', 'utf8')

    expect(gitMetadata(root)).toBeNull()
  })

  test('uses the worktree gitdir when commondir is empty', async () => {
    const gitDir = join(root, 'metadata')
    await mkdir(gitDir)
    await writeFile(join(root, '.git'), `gitdir: ${gitDir}\n`, 'utf8')
    await writeFile(join(gitDir, 'commondir'), '\n', 'utf8')

    expect(gitMetadata(root)?.commonDir).toBe(gitDir)
    expect(dirname(gitMetadata(root)!.gitDir)).toBe(root)
  })
})
