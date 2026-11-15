import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { branchNameFor, validateForkUrl, validateName } from '@main/customise/slug'
import { pickDevPort, PORT_RANGE } from '@main/customise/ports'
import { customisationLaunchEnv } from '@main/customise/launchEnv'
import { provisionCustomisation, type ProvisionDeps, type ProvisionInput } from '@main/customise/provision'
import { nextStatus } from '@main/customise/state'
import { CustomiseService } from '@main/customise/service'
import { CustomisationStore } from '@main/store/customisations'
import { MIGRATIONS } from '@main/db/migrations'

describe('naming and fork validation', () => {
  test('a copy name becomes a customise/ branch, slugged', () => {
    expect(branchNameFor('  My Roster!  ')).toBe('customise/my-roster')
    expect(branchNameFor('Sidebar & tabs')).toBe('customise/sidebar-tabs')
  })

  test('a name with nothing usable in it is refused', () => {
    expect(() => validateName('   ')).toThrow(/name/i)
    expect(() => branchNameFor('!!!')).toThrow(/name/i)
    expect(validateName(' Fork  ')).toBe('Fork')
  })

  test('the fork is optional, and a git URL when given', () => {
    expect(validateForkUrl(undefined)).toBeNull()
    expect(validateForkUrl('  ')).toBeNull()
    expect(validateForkUrl('https://github.com/me/roster.git')).toBe('https://github.com/me/roster.git')
    expect(validateForkUrl('git@github.com:me/roster.git')).toBe('git@github.com:me/roster.git')
    expect(validateForkUrl('ssh://git@host/me/roster.git')).toBe('ssh://git@host/me/roster.git')
    expect(() => validateForkUrl('not a url')).toThrow(/fork/i)
    expect(() => validateForkUrl('file:///etc')).toThrow(/fork/i)
  })
})

describe('port selection', () => {
  test('takes the first port in the range that is neither taken nor busy', async () => {
    const isFree = vi.fn(async (port: number) => port !== 5181)
    const port = await pickDevPort([PORT_RANGE.start], isFree)
    expect(port).toBe(PORT_RANGE.start + 2)
    expect(isFree).not.toHaveBeenCalledWith(PORT_RANGE.start)
  })

  test('never hands out 5173, the official app port', () => {
    expect(PORT_RANGE.start).toBeGreaterThan(5173)
  })

  test('fails loudly when the range is exhausted', async () => {
    await expect(pickDevPort([], async () => false, { start: 6000, end: 6001 })).rejects.toThrow(/free port/)
  })
})

describe('launch environment', () => {
  test('a copy runs with its own home, port and the updater flag, and nothing else', () => {
    expect(customisationLaunchEnv({ rosterHome: '/x/home', devPort: 5190 })).toEqual({
      ROSTER_HOME: '/x/home',
      ROSTER_DEV_PORT: '5190',
      ROSTER_CUSTOMISED: '1',
    })
  })
})

describe('status state machine', () => {
  test('provisioning ends in ready or failed; failed can be retried', () => {
    expect(nextStatus('provisioning', 'succeed')).toBe('ready')
    expect(nextStatus('provisioning', 'fail')).toBe('failed')
    expect(nextStatus('failed', 'start')).toBe('provisioning')
  })

  test('a ready copy cannot be provisioned again, and nothing is skipped', () => {
    expect(() => nextStatus('ready', 'start')).toThrow()
    expect(() => nextStatus('failed', 'succeed')).toThrow()
    expect(() => nextStatus('provisioning', 'start')).toThrow()
  })
})

/** A recording stand-in for git, npm and the filesystem. */
function fakeDeps(options: { existing?: string[]; remotes?: string[]; branches?: string[]; excludeText?: string } = {}) {
  const existing = new Set(options.existing ?? [])
  let remotes = [...(options.remotes ?? [])]
  const branches = new Set(options.branches ?? [])
  const calls: string[] = []
  const steps: string[] = []
  const deps: ProvisionDeps = {
    run: vi.fn(async (file: string, args: string[], cwd?: string) => {
      const line = [file, ...args].join(' ')
      calls.push(cwd ? `${line} @${cwd}` : line)
      // A real clone leaves its source behind as origin and writes .git.
      if (args[0] === 'clone') {
        remotes = ['origin']
        existing.add(join(args[args.length - 1]!, '.git'))
        return ''
      }
      if (args[0] === 'remote' && args.length === 1) return remotes.join('\n')
      if (args[0] === 'remote' && args[1] === 'rename') {
        remotes = remotes.map((r) => (r === args[2] ? args[3]! : r))
        return ''
      }
      if (args[0] === 'remote' && args[1] === 'add') {
        remotes.push(args[2]!)
        return ''
      }
      if (args[0] === 'remote' && args[1] === 'set-url') return ''
      if (args[0] === 'branch' && args[1] === '--list') return branches.has(args[2]!) ? args[2]! : ''
      if (args[0] === 'checkout') {
        branches.add(args[2]!)
        return ''
      }
      if (args[0] === 'rev-parse') return 'b'.repeat(40)
      return ''
    }),
    exists: (path: string) => existing.has(path),
    readText: async () => options.excludeText ?? '',
    writeText: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    onStep: (step: string) => steps.push(step),
  }
  return { deps, calls, steps, remotesNow: () => remotes }
}

const INPUT = {
  path: '/roster/customisations/c1',
  homeDir: '/roster/customisations/c1/home',
  sourceUrl: 'https://github.com/jwnwilson/roster.git',
  forkUrl: 'https://github.com/me/roster.git',
  branch: 'customise/fork',
  acknowledgedAt: 1,
}

describe('provisioning', () => {
  test('refuses to run before the user has acknowledged the warning', async () => {
    const { deps, calls } = fakeDeps()
    await expect(provisionCustomisation({ ...INPUT, acknowledgedAt: null }, deps)).rejects.toThrow(/acknowledge/i)
    expect(calls).toEqual([])
  })

  test('clones main, keeps the source as upstream, points origin at the fork, and branches', async () => {
    const { deps, calls, remotesNow, steps } = fakeDeps()
    const result = await provisionCustomisation(INPUT, deps)

    expect(calls[0]).toBe(
      `git clone --branch main ${INPUT.sourceUrl} ${INPUT.path}`,
    )
    expect(remotesNow()).toEqual(['upstream', 'origin'])
    expect(calls).toContain(`git remote add origin ${INPUT.forkUrl} @${INPUT.path}`)
    expect(calls).toContain(`git checkout -b customise/fork @${INPUT.path}`)
    expect(result.baseSha).toBe('b'.repeat(40))
    expect(steps.length).toBeGreaterThan(0)
  })

  test('the home directory is excluded from git so it can never be committed', async () => {
    const { deps } = fakeDeps()
    await provisionCustomisation(INPUT, deps)
    expect(deps.mkdir).toHaveBeenCalledWith(INPUT.homeDir)
    expect(deps.writeText).toHaveBeenCalledWith(`${INPUT.path}/.git/info/exclude`, expect.stringContaining('/home/'))
  })

  test('installs dependencies and fixes a missing Electron binary', async () => {
    const { deps, calls } = fakeDeps({ existing: [INPUT.path + '/.git'] })
    await provisionCustomisation(INPUT, deps)
    expect(calls).toContain(`npm install @${INPUT.path}`)
    expect(calls).toContain(`node node_modules/electron/install.js @${INPUT.path}`)
  })

  test('skips the Electron fix when the binary is already there', async () => {
    const { deps, calls } = fakeDeps({ existing: [INPUT.path + '/node_modules/electron/dist'] })
    await provisionCustomisation(INPUT, deps)
    expect(calls.some((c) => c.includes('electron/install.js'))).toBe(false)
  })

  test('is idempotent: a retry does not clone again, duplicate remotes, or rebranch', async () => {
    const first = fakeDeps()
    await provisionCustomisation(INPUT, first.deps)

    const again = fakeDeps({
      existing: [INPUT.path + '/.git', INPUT.path + '/node_modules/electron/dist'],
      remotes: ['upstream', 'origin'],
      branches: ['customise/fork'],
      excludeText: '/home/\n',
    })
    const result = await provisionCustomisation(INPUT, again.deps)

    expect(again.calls.some((c) => c.startsWith('git clone'))).toBe(false)
    expect(again.calls.some((c) => c.startsWith('git remote add'))).toBe(false)
    expect(again.calls.some((c) => c.startsWith('git checkout -b'))).toBe(false)
    expect(again.remotesNow()).toEqual(['upstream', 'origin'])
    // Only a fresh clone records the base commit; a retry keeps the stored one.
    expect(result.baseSha).toBeNull()
  })

  test('a copy with no fork has an upstream and no origin', async () => {
    const { deps, remotesNow } = fakeDeps()
    await provisionCustomisation({ ...INPUT, forkUrl: null }, deps)
    expect(remotesNow()).toEqual(['upstream'])
  })

  test('an existing fork is repointed when the URL changes', async () => {
    const { deps, calls } = fakeDeps({ existing: [INPUT.path + '/.git'], remotes: ['upstream', 'origin'] })
    await provisionCustomisation({ ...INPUT, forkUrl: 'https://github.com/me/other.git' }, deps)
    expect(calls).toContain(`git remote set-url origin https://github.com/me/other.git @${INPUT.path}`)
  })
})

describe('CustomiseService', () => {
  let dir: string
  let db: Db
  let store: CustomisationStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'roster-customise-'))
    db = openDatabase(':memory:')
    store = new CustomisationStore(db)
  })

  afterEach(async () => {
    db.close()
    await rm(dir, { recursive: true, force: true })
  })

  type Provision = (input: ProvisionInput, deps: ProvisionDeps) => Promise<{ baseSha: string | null }>
  function service(provision: Provision = vi.fn(async () => ({ baseSha: 'c'.repeat(40) }))) {
    const changes: number[] = []
    const svc = new CustomiseService({
      store,
      root: join(dir, 'customisations'),
      sourceUrl: INPUT.sourceUrl,
      pickPort: async () => 5190,
      provision,
      onChanged: (list) => changes.push(list.length),
    })
    return { svc, changes, provision }
  }

  test('nothing runs without acknowledged_at: create refuses and provisions nothing', async () => {
    const { svc, provision } = service()
    await expect(svc.create({ name: 'Mine', forkUrl: null, acknowledged: false })).rejects.toThrow(/acknowledge/i)
    expect(provision).not.toHaveBeenCalled()
    expect(store.list()).toEqual([])
  })

  test('create records the copy, gives it its own home and port, and provisions it', async () => {
    const { svc, provision } = service()
    const created = await svc.create({ name: 'Mine', forkUrl: 'https://github.com/me/roster.git', acknowledged: true })

    expect(created.status).toBe('provisioning')
    expect(created.devPort).toBe(5190)
    expect(created.rosterHome).toBe(join(created.path, 'home'))
    expect(created.acknowledgedAt).toBeGreaterThan(0)

    await vi.waitFor(() => expect(store.findById(created.id)?.status).toBe('ready'))
    expect(provision).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'customise/mine', forkUrl: 'https://github.com/me/roster.git', acknowledgedAt: created.acknowledgedAt }),
      expect.anything(),
    )
    expect(store.findById(created.id)?.baseSha).toBe('c'.repeat(40))
  })

  test('a failed provision is recorded with its error, and retry resumes it', async () => {
    const provision = vi
      .fn<Provision>()
      .mockRejectedValueOnce(new Error('npm install failed'))
      .mockResolvedValueOnce({ baseSha: null })
    const { svc } = service(provision)
    const created = await svc.create({ name: 'Mine', forkUrl: null, acknowledged: true })

    await vi.waitFor(() => expect(store.findById(created.id)?.status).toBe('failed'))
    expect(store.findById(created.id)?.error).toBe('npm install failed')

    await svc.retry(created.id)
    await vi.waitFor(() => expect(store.findById(created.id)?.status).toBe('ready'))
    expect(store.findById(created.id)?.error).toBeNull()
  })

  test('progress from a running provision is visible on the copy', async () => {
    let release!: () => void
    const provision = vi.fn(
      (_input: unknown, deps: ProvisionDeps) =>
        new Promise<{ baseSha: null }>((resolve) => {
          deps.onStep('Installing dependencies…')
          release = () => resolve({ baseSha: null })
        }),
    )
    const { svc } = service(provision)
    const created = await svc.create({ name: 'Mine', forkUrl: null, acknowledged: true })
    await vi.waitFor(() => expect(svc.list()[0]?.progress).toBe('Installing dependencies…'))
    release()
    await vi.waitFor(() => expect(svc.list()[0]?.status).toBe('ready'))
    expect(svc.list()[0]?.progress).toBeNull()
    expect(created.id).toBeTruthy()
  })

  test('retry is refused for a copy that is not failed', async () => {
    const { svc } = service()
    const created = await svc.create({ name: 'Mine', forkUrl: null, acknowledged: true })
    await vi.waitFor(() => expect(store.findById(created.id)?.status).toBe('ready'))
    await expect(svc.retry(created.id)).rejects.toThrow()
  })

  test('a copy interrupted mid-provision is failed on the next launch, not left spinning', async () => {
    const { svc } = service(() => new Promise(() => {}))
    await svc.create({ name: 'Mine', forkUrl: null, acknowledged: true })
    expect(store.recoverInterrupted()).toBe(1)
    expect(store.list()[0]?.status).toBe('failed')
    expect(store.list()[0]?.error).toMatch(/interrupted/i)
  })

  test('the copy list reports every change to the window', async () => {
    const { svc, changes } = service()
    await svc.create({ name: 'Mine', forkUrl: null, acknowledged: true })
    expect(changes.length).toBeGreaterThan(0)
  })
})

describe('customisations store', () => {
  test('the migration adds the table, and the store round-trips a row', () => {
    const db = openDatabase(':memory:')
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(20)
    const store = new CustomisationStore(db)
    store.insert({
      id: 'c1', name: 'Mine', path: '/p', forkRemote: null, baseSha: null,
      rosterHome: '/p/home', devPort: 5180, acknowledgedAt: 5, createdAt: 4,
    })
    expect(store.findById('c1')).toMatchObject({ name: 'Mine', status: 'provisioning', devPort: 5180 })
    store.setStatus('c1', 'failed', { error: 'boom' })
    expect(store.findById('c1')).toMatchObject({ status: 'failed', error: 'boom' })
    expect(store.usedPorts()).toEqual([5180])
    db.close()
  })
})
