import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { ProjectRepoStore } from '@main/store/projectRepos'
import { ProjectStore } from '@main/store/projects'
import { canonicalPath, resolveWorkspace, samePath } from '@main/sessions/workspace'
import type { Agent, ProjectRepo, Session } from '@shared/types'

let dir: string
let db: Db
let projects: ProjectStore
let repos: ProjectRepoStore
let projectId: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'roster-repos-'))
  db = openDatabase(':memory:')
  projects = new ProjectStore(db)
  repos = new ProjectRepoStore(db)
  projectId = projects.create({ name: 'Checkout rewrite', color: '#fff' }).id
})

afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

/** A real directory, so `exists` and `realpath` have something to answer. */
async function checkout(name: string): Promise<string> {
  const path = join(dir, name)
  await mkdir(path, { recursive: true })
  return path
}

describe('samePath', () => {
  test('ignores a trailing separator', async () => {
    const path = await checkout('api')

    expect(samePath(path, `${path}/`)).toBe(true)
  })

  test('ignores "." and ".." segments', async () => {
    const path = await checkout('api')

    expect(samePath(path, join(path, '.'))).toBe(true)
    expect(samePath(path, join(path, 'nested', '..'))).toBe(true)
  })

  test('follows a symlink to the directory it points at', async () => {
    const real = await checkout('payments')
    const link = join(dir, 'payments-link')
    await symlink(real, link)

    expect(samePath(real, link)).toBe(true)
  })

  test('expands ~ to the home directory', () => {
    expect(samePath('~', homedir())).toBe(true)
  })

  test('separates two genuinely different directories', async () => {
    const api = await checkout('api')
    const web = await checkout('web')

    expect(samePath(api, web)).toBe(false)
  })

  test('compares a path that does not exist against itself', () => {
    const missing = join(dir, 'moved-away')

    // realpath cannot resolve it, so the resolved form is compared as
    // written — a deleted repository must still equal itself.
    expect(samePath(missing, `${missing}/`)).toBe(true)
  })
})

describe('canonicalPath', () => {
  test('does not fold case, so a directory name survives a round trip', async () => {
    const path = await checkout('MixedCase')

    expect(canonicalPath(path)).toContain('MixedCase')
  })
})

describe('ProjectRepoStore', () => {
  test('names a repository after its directory when none is given', async () => {
    const path = await checkout('payments')

    const repo = repos.add({ projectId, path })

    expect(repo.name).toBe('payments')
    expect(repo.position).toBe(0)
    expect(repo.exists).toBe(true)
  })

  test('normalises the path so one directory cannot be added twice', async () => {
    const path = await checkout('api')

    const first = repos.add({ projectId, path })
    const second = repos.add({ projectId, path: `${path}/` })

    expect(second.id).toBe(first.id)
    expect(repos.listByProject(projectId)).toHaveLength(1)
  })

  test('orders repositories by position, primary first', async () => {
    const api = repos.add({ projectId, path: await checkout('api') })
    const web = repos.add({ projectId, path: await checkout('web') })

    expect(repos.listByProject(projectId).map((repo) => repo.id)).toEqual([api.id, web.id])
    expect(api.position).toBe(0)
    expect(web.position).toBe(1)
  })

  test('reorder makes the named repository the primary', async () => {
    const api = repos.add({ projectId, path: await checkout('api') })
    const web = repos.add({ projectId, path: await checkout('web') })

    const ordered = repos.reorder(projectId, [web.id, api.id])

    expect(ordered.map((repo) => repo.name)).toEqual(['web', 'api'])
    expect(ordered[0]?.position).toBe(0)
  })

  test('reorder keeps a repository the caller did not name', async () => {
    const api = repos.add({ projectId, path: await checkout('api') })
    const web = repos.add({ projectId, path: await checkout('web') })
    const types = repos.add({ projectId, path: await checkout('types') })

    // A window that had not seen `types` yet must not delete it by saving a
    // stale order.
    const ordered = repos.reorder(projectId, [web.id, api.id])

    expect(ordered.map((repo) => repo.id)).toEqual([web.id, api.id, types.id])
  })

  test('removing the primary promotes the next repository', async () => {
    const api = repos.add({ projectId, path: await checkout('api') })
    const web = repos.add({ projectId, path: await checkout('web') })

    repos.remove(api.id)

    const remaining = repos.listByProject(projectId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(web.id)
    // Without compaction this would be 1, leaving the project with no primary.
    expect(remaining[0]?.position).toBe(0)
  })

  test('a blank name falls back to the directory name', async () => {
    const repo = repos.add({ projectId, path: await checkout('payments'), name: 'Payments API' })

    expect(repos.update(repo.id, { name: '   ' }).name).toBe('payments')
  })

  test('marks a repository that is not a git checkout', async () => {
    const repo = repos.add({ projectId, path: await checkout('docs') })

    // Shown and marked rather than refused: a docs folder is legitimate
    // context that is not a checkout.
    expect(repo.exists).toBe(true)
    expect(repo.isRepository).toBe(false)
  })

  test('marks a repository whose directory has gone', async () => {
    const path = await checkout('moved')
    const repo = repos.add({ projectId, path })
    await rm(path, { recursive: true, force: true })

    expect(repos.listByProject(projectId)[0]?.exists).toBe(false)
    expect(repo.id).toBeDefined()
  })

  test('deleting the project deletes its repository rows', async () => {
    repos.add({ projectId, path: await checkout('api') })

    projects.delete(projectId)

    expect(repos.listByProject(projectId)).toEqual([])
  })

  test('two projects may name the same directory', async () => {
    const other = projects.create({ name: 'Other', color: '#000' }).id
    const path = await checkout('shared')

    repos.add({ projectId, path })
    repos.add({ projectId: other, path })

    // The unique index is per project: one checkout can belong to two pieces
    // of work, and often does.
    expect(repos.listByProject(projectId)).toHaveLength(1)
    expect(repos.listByProject(other)).toHaveLength(1)
  })
})

/* --------------------------------------------------------- resolveWorkspace */

const AGENT = { id: 'a1', cwd: '/agents/a1/workspace' } as Agent

function aSession(overrides: Partial<Session> = {}): Session {
  return { id: 's1', agentId: 'a1', ...overrides } as Session
}

function aRepo(path: string, position: number): ProjectRepo {
  return {
    id: `r${position}`,
    projectId: 'p1',
    path,
    pathLabel: path,
    name: path.split('/').pop() ?? path,
    description: '',
    position,
    exists: true,
    isRepository: true,
  }
}

describe('resolveWorkspace', () => {
  test('falls back to the agent when the project names no repositories', () => {
    const workspace = resolveWorkspace({ agent: AGENT, session: aSession(), repos: [] })

    // Yesterday's behaviour, and still the answer for every unfiled session.
    expect(workspace).toMatchObject({ root: AGENT.cwd, additional: [], source: 'agent' })
  })

  test('runs in the project primary rather than the agent directory', () => {
    const repos = [aRepo('/work/api', 0), aRepo('/work/web', 1)]

    const workspace = resolveWorkspace({ agent: AGENT, session: aSession(), repos })

    // This is what makes one agent reusable across projects.
    expect(workspace.root).toBe('/work/api')
    expect(workspace.source).toBe('project')
    expect(workspace.additional).toEqual(['/work/web'])
  })

  test('a session that has already run stays where it ran', () => {
    const repos = [aRepo('/work/api', 0)]
    const session = aSession({ workspaceRoot: '/work/payments' })

    const workspace = resolveWorkspace({ agent: AGENT, session, repos })

    // A resumed Codex thread cannot be moved off its original directory, so
    // the pin outranks a primary that has since changed.
    expect(workspace.root).toBe('/work/payments')
    expect(workspace.source).toBe('session')
  })

  test('the pinned root is still offered as reachable when it is not the primary', () => {
    const repos = [aRepo('/work/api', 0), aRepo('/work/web', 1)]
    const session = aSession({ workspaceRoot: '/work/web' })

    const workspace = resolveWorkspace({ agent: AGENT, session, repos })

    expect(workspace.root).toBe('/work/web')
    expect(workspace.additional).toEqual(['/work/api'])
  })

  test('never offers the root as one of the additional roots', () => {
    const repos = [aRepo('/work/api', 0)]

    const workspace = resolveWorkspace({ agent: AGENT, session: aSession(), repos })

    // Handing the same directory over twice is at best noise and at worst a
    // second, conflicting grant.
    expect(workspace.additional).toEqual([])
  })

  test('deduplicates the root even when it is spelled differently', () => {
    const repos = [aRepo('/work/api/', 0), aRepo('/work/web', 1)]
    const session = aSession({ workspaceRoot: '/work/api' })

    const workspace = resolveWorkspace({ agent: AGENT, session, repos })

    // The pin and the row can disagree about a trailing slash; samePath is
    // what stops that becoming a duplicate grant.
    expect(workspace.additional).toEqual(['/work/web'])
  })
})
