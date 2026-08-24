import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { McpStore } from '@main/store/mcp'
import { SessionStore } from '@main/store/sessions'
import { SkillStore } from '@main/store/skills'
import { UsageStore } from '@main/store/usage'
import { seedIfEmpty } from '@main/store/seed'
import { agentsDir, mcpConfigPath, skillsDir } from '@main/store/paths'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'roster-stores-'))
  process.env['ROSTER_HOME'] = home
})

afterEach(async () => {
  delete process.env['ROSTER_HOME']
  await rm(home, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ usage */

describe('UsageStore', () => {
  let db: Db
  let store: UsageStore
  let sessions: SessionStore

  beforeEach(() => {
    db = openDatabase(':memory:')
    store = new UsageStore(db)
    sessions = new SessionStore(db)
  })

  test('reports nothing before a session has run', () => {
    expect(store.forSession('nobody')).toBeNull()
  })

  test('round-trips a recording', () => {
    const s = sessions.create({ agentId: 'a', title: 'x', origin: 'you' })
    store.record({
      sessionId: s.id,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 95,
      costUsd: 0.5,
    })

    expect(store.forSession(s.id)).toEqual({
      sessionId: s.id,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 95,
      costUsd: 0.5,
    })
  })

  test('replaces rather than accumulates, since runners report totals', () => {
    const s = sessions.create({ agentId: 'a', title: 'x', origin: 'you' })
    store.record({ sessionId: s.id, inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.5 })
    store.record({ sessionId: s.id, inputTokens: 30, outputTokens: 9, totalTokens: 39, costUsd: 1.5 })

    expect(store.forSession(s.id)).toMatchObject({ inputTokens: 30, totalTokens: 39, costUsd: 1.5 })
  })

  test('totals every session an agent owns, for its grid card', () => {
    const a = sessions.create({ agentId: 'debugging', title: '1', origin: 'you' })
    const b = sessions.create({ agentId: 'debugging', title: '2', origin: 'you' })
    const other = sessions.create({ agentId: 'review', title: '3', origin: 'you' })

    store.record({ sessionId: a.id, inputTokens: 10, outputTokens: 5, totalTokens: 800, costUsd: 1 })
    store.record({ sessionId: b.id, inputTokens: 20, outputTokens: 5, totalTokens: 200, costUsd: 2 })
    store.record({ sessionId: other.id, inputTokens: 99, outputTokens: 0, totalTokens: 99, costUsd: 9 })

    expect(store.byAgent()['debugging']).toEqual({ tokens: 1_000, costUsd: 3 })
  })

  test('counts the cached tokens, not just input plus output', () => {
    // The regression: a real Claude turn is mostly cache, so summing
    // input + output reported a few hundred tokens against dollars of spend.
    const s = sessions.create({ agentId: 'debugging', title: '1', origin: 'you' })
    store.record({
      sessionId: s.id,
      inputTokens: 18,
      outputTokens: 297,
      totalTokens: 77_913,
      costUsd: 0.94,
    })

    expect(store.byAgent()['debugging']?.tokens).toBe(77_913)
  })

  test('keeps agents apart', () => {
    const a = sessions.create({ agentId: 'debugging', title: '1', origin: 'you' })
    store.record({ sessionId: a.id, inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 1 })

    expect(store.byAgent()['review']).toBeUndefined()
  })

  test('an agent with no usage is simply absent', () => {
    expect(store.byAgent()).toEqual({})
  })
})

/* ----------------------------------------------------------------- skills */

describe('SkillStore', () => {
  async function writeSkill(name: string, files: Record<string, string>): Promise<void> {
    await mkdir(join(skillsDir(), name), { recursive: true })
    for (const [file, body] of Object.entries(files)) {
      const path = join(skillsDir(), name, file)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, body, 'utf8')
    }
  }

  test('creates the library directory when missing', async () => {
    const store = new SkillStore()
    await store.load()
    expect(store.findAll()).toEqual([])
  })

  test('lists skills alphabetically with their files', async () => {
    await writeSkill('zeta', { 'SKILL.md': '# Z' })
    await writeSkill('alpha', { 'SKILL.md': '# A', 'repro.py': 'x' })

    const store = new SkillStore()
    await store.load()

    expect(store.findAll().map((s) => s.name)).toEqual(['alpha', 'zeta'])
    expect(store.findAll()[0]?.files).toEqual(['SKILL.md', 'repro.py'])
  })

  test('walks nested directories', async () => {
    await writeSkill('alpha', { 'SKILL.md': '# A', 'templates/pytest.py': 'x' })

    const store = new SkillStore()
    await store.load()

    expect(store.findAll()[0]?.files).toContain('templates/')
    expect(store.findAll()[0]?.files).toContain('templates/pytest.py')
  })

  test('skips dotfiles', async () => {
    await writeSkill('alpha', { 'SKILL.md': '# A', '.DS_Store': 'x' })

    const store = new SkillStore()
    await store.load()
    expect(store.findAll()[0]?.files).toEqual(['SKILL.md'])
  })

  test('reads and writes a file in the library', async () => {
    await writeSkill('alpha', { 'SKILL.md': '# A' })
    const store = new SkillStore()
    await store.load()

    const path = join(skillsDir(), 'alpha', 'SKILL.md')
    expect(await store.read(path)).toBe('# A')

    await store.write(path, '# Changed')
    expect(await readFile(path, 'utf8')).toBe('# Changed')
  })

  test('refuses to read outside the library', async () => {
    const store = new SkillStore()
    await store.load()

    // A path-traversal attempt must not escape the skill root.
    await expect(store.read(join(skillsDir(), '..', '..', 'etc', 'passwd'))).rejects.toThrow(
      /outside the skill library/,
    )
  })

  test('refuses to write outside the library', async () => {
    const store = new SkillStore()
    await store.load()

    await expect(store.write('/tmp/escaped.txt', 'x')).rejects.toThrow(/outside the skill library/)
  })
})

/* -------------------------------------------------------------------- mcp */

describe('McpStore', () => {
  async function writeConfig(body: unknown): Promise<void> {
    await mkdir(home, { recursive: true })
    await writeFile(mcpConfigPath(), JSON.stringify(body), 'utf8')
  }

  test('treats a missing file as no servers rather than crashing', async () => {
    const store = new McpStore()
    await store.load()
    expect(store.findAll()).toEqual([])
  })

  test('treats a corrupt file as no servers rather than crashing', async () => {
    await mkdir(home, { recursive: true })
    await writeFile(mcpConfigPath(), 'not json at all', 'utf8')

    const store = new McpStore()
    await store.load()
    expect(store.findAll()).toEqual([])
  })

  test('reads servers and how to launch them', async () => {
    await writeConfig({ servers: [{ name: 'filesystem', command: 'npx fs' }] })

    const store = new McpStore()
    await store.load()

    expect(store.findAll()).toEqual([{ name: 'filesystem', command: 'npx fs' }])
  })

  test('fills in defaults for a partially written entry', async () => {
    await writeConfig({ servers: [{ name: 'partial' }] })

    const store = new McpStore()
    await store.load()

    expect(store.findAll()[0]).toEqual({ name: 'partial', command: '' })
  })

  test('drops the enabledFor list older files carry', async () => {
    // Enablement moved to agent.toml; a stale list here must not come back
    // and become a second, disagreeing answer.
    await writeConfig({
      servers: [{ name: 'filesystem', command: 'npx fs', enabledFor: ['debugging'] }],
    })

    const store = new McpStore()
    await store.load()

    expect(store.findAll()[0]).toEqual({ name: 'filesystem', command: 'npx fs' })
  })

  test('rewriting the file does not persist enablement', async () => {
    await writeConfig({
      servers: [{ name: 'filesystem', command: 'npx fs', enabledFor: ['debugging'] }],
    })
    const store = new McpStore()
    await store.load()

    await store.install('github', 'npx server-github')

    const raw = await readFile(mcpConfigPath(), 'utf8')
    expect(raw).not.toContain('enabledFor')
  })
})

/* ------------------------------------------------------------------- seed */

describe('seedIfEmpty', () => {
  test('creates agents, skills, and an mcp config on a fresh install', async () => {
    const seeded = await seedIfEmpty(mcpConfigPath())

    expect(seeded).toBe(true)

    const store = new SkillStore()
    await store.load()
    expect(store.findAll().length).toBeGreaterThan(0)

    const mcp = new McpStore()
    await mcp.load()
    expect(mcp.findAll().length).toBeGreaterThan(0)
  })

  test('creates the shared workspace, so an approved write has somewhere to go', async () => {
    await seedIfEmpty(mcpConfigPath())

    const store = new SkillStore()
    await store.load()
    // The workspace must exist: spawning into a missing cwd fails with ENOENT.
    await expect(readFile(join(home, 'workspace', '.keep'), 'utf8')).rejects.toThrow()
    const { access } = await import('node:fs/promises')
    await expect(access(join(home, 'workspace'))).resolves.toBeUndefined()
  })

  test('never overwrites an existing roster', async () => {
    await mkdir(join(agentsDir(), 'mine'), { recursive: true })

    expect(await seedIfEmpty(mcpConfigPath())).toBe(false)
  })
})

/* --------------------------------------------------- skills: create/reveal */

describe('SkillStore.create', () => {
  test('creates a folder with a starter SKILL.md', async () => {
    const store = new SkillStore()
    await store.load()

    const created = await store.create('Repro Harness')

    expect(created.name).toBe('repro-harness')
    expect(created.files).toEqual(['SKILL.md'])
    expect(await store.read(join(created.path, 'SKILL.md'))).toContain('# Repro Harness')
  })

  test('slugifies the name, since it is also a directory name', async () => {
    const store = new SkillStore()
    await store.load()

    const created = await store.create('  My New Skill!  ')
    expect(created.name).toBe('my-new-skill')
  })

  test('suffixes a clashing name rather than overwriting existing work', async () => {
    const store = new SkillStore()
    await store.load()

    await store.create('duplicate')
    const second = await store.create('duplicate')

    expect(second.name).toBe('duplicate-2')
  })

  test('falls back to a usable name when the input has no usable characters', async () => {
    const store = new SkillStore()
    await store.load()

    expect((await store.create('///')).name).toBe('new-skill')
  })

  test('the new skill appears in the library immediately', async () => {
    const store = new SkillStore()
    await store.load()
    await store.create('fresh')

    expect(store.findAll().map((s) => s.name)).toContain('fresh')
  })
})

describe('SkillStore.pathOf', () => {
  test('resolves a skill to its folder', async () => {
    const store = new SkillStore()
    await store.load()
    const created = await store.create('locatable')

    expect(store.pathOf('locatable')).toBe(created.path)
  })

  test('returns nothing for a skill that is not there', async () => {
    const store = new SkillStore()
    await store.load()

    expect(store.pathOf('ghost')).toBeNull()
  })
})

/* --------------------------------------------------------- mcp: install */

describe('McpStore.install', () => {
  test('adds a server with its launch command', async () => {
    const store = new McpStore()
    await store.load()

    const servers = await store.install('linear', 'npx server-linear')

    expect(servers).toEqual([{ name: 'linear', command: 'npx server-linear' }])
  })

  test('persists to disk', async () => {
    const store = new McpStore()
    await store.load()
    await store.install('linear', 'npx server-linear')

    const reopened = new McpStore()
    await reopened.load()
    expect(reopened.findAll().map((s) => s.name)).toEqual(['linear'])
  })

  test('installing an existing server does not duplicate or clobber it', async () => {
    const store = new McpStore()
    await store.load()
    await store.install('linear', 'npx server-linear')

    await store.install('linear', 'a-different-command')

    expect(store.findAll()).toHaveLength(1)
    // The command someone already tuned must survive.
    expect(store.findAll()[0]?.command).toBe('npx server-linear')
  })
})

/* ------------------------------------------- agents: working directory */

describe('AgentStore.update — working directory', () => {
  test('writes the new directory and creates it', async () => {
    const { AgentStore } = await import('@main/store/agents')
    const { mkdir: makeDir, writeFile: write } = await import('node:fs/promises')

    await makeDir(join(home, 'agents', 'a'), { recursive: true })
    await write(
      join(home, 'agents', 'a', 'agent.toml'),
      'name = "A"\nrunner = "claude"\nmodel = "m"\ncwd = "/tmp"\n',
      'utf8',
    )

    const store = new AgentStore(() => new Map())
    await store.load()

    const target = join(home, 'brand-new-workspace')
    await store.update('a', { cwd: target })

    // Spawning into a missing cwd fails with a misleading ENOENT.
    const { access } = await import('node:fs/promises')
    await expect(access(target)).resolves.toBeUndefined()
    expect(store.findById('a')?.cwd).toBe(target)
  })
})

/* ------------------------------------------- skills: files and folders */

describe('SkillStore.createFile', () => {
  async function withSkill() {
    const store = new SkillStore()
    await store.load()
    await store.create('repro-harness')
    return store
  }

  test('creates an empty file inside the skill', async () => {
    const store = await withSkill()

    const path = await store.createFile('repro-harness', 'repro.py')

    expect(await store.read(path)).toBe('')
    expect(store.findAll()[0]?.files).toContain('repro.py')
  })

  test('creates parent folders the path implies', async () => {
    const store = await withSkill()

    await store.createFile('repro-harness', 'templates/pytest.py')

    const files = store.findAll()[0]?.files ?? []
    expect(files).toContain('templates/')
    expect(files).toContain('templates/pytest.py')
  })

  test('refuses to overwrite an existing file', async () => {
    const store = await withSkill()

    // SKILL.md was written when the skill was created.
    await expect(store.createFile('repro-harness', 'SKILL.md')).rejects.toThrow(/already exists/)
  })

  test('refuses a path that escapes the skill', async () => {
    const store = await withSkill()

    await expect(store.createFile('repro-harness', '../escaped.md')).rejects.toThrow(
      /outside the skill/,
    )
  })

  test('refuses a path that escapes via a nested traversal', async () => {
    const store = await withSkill()

    await expect(
      store.createFile('repro-harness', 'templates/../../escaped.md'),
    ).rejects.toThrow(/outside the skill/)
  })

  test('refuses an absolute path', async () => {
    const store = await withSkill()

    await expect(store.createFile('repro-harness', '/etc/passwd')).rejects.toThrow(
      /absolute path/,
    )
  })

  test('refuses an empty name', async () => {
    const store = await withSkill()

    await expect(store.createFile('repro-harness', '   ')).rejects.toThrow(/name is required/)
  })

  test('refuses a name that resolves to the skill folder itself', async () => {
    const store = await withSkill()

    await expect(store.createFile('repro-harness', '.')).rejects.toThrow(/name is required/)
  })

  test('refuses an unknown skill', async () => {
    const store = await withSkill()

    await expect(store.createFile('ghost', 'a.md')).rejects.toThrow(/unknown skill/)
  })
})

describe('SkillStore.createFolder', () => {
  async function withSkill() {
    const store = new SkillStore()
    await store.load()
    await store.create('repro-harness')
    return store
  }

  test('creates a folder inside the skill', async () => {
    const store = await withSkill()

    await store.createFolder('repro-harness', 'templates')

    expect(store.findAll()[0]?.files).toContain('templates/')
  })

  test('creates nested folders in one go', async () => {
    const store = await withSkill()

    await store.createFolder('repro-harness', 'templates/pytest')

    const files = store.findAll()[0]?.files ?? []
    expect(files).toContain('templates/')
    expect(files).toContain('templates/pytest/')
  })

  test('refuses one that already exists', async () => {
    const store = await withSkill()
    await store.createFolder('repro-harness', 'templates')

    await expect(store.createFolder('repro-harness', 'templates')).rejects.toThrow(
      /already exists/,
    )
  })

  test('refuses a path that escapes the skill', async () => {
    const store = await withSkill()

    await expect(store.createFolder('repro-harness', '../escaped')).rejects.toThrow(
      /outside the skill/,
    )
  })
})

/* -------------------------------------------------- skills: deletion */

describe('SkillStore — deletion', () => {
  /** Records what was sent to the Trash instead of needing a desktop. */
  function trashSpy() {
    const trashed: string[] = []
    return {
      trashed,
      toTrash: async (path: string) => {
        trashed.push(path)
        await rm(path, { recursive: true, force: true })
      },
    }
  }

  async function withSkill(toTrash: (p: string) => Promise<void>) {
    const store = new SkillStore(toTrash)
    await store.load()
    await store.create('repro-harness')
    await store.createFile('repro-harness', 'templates/pytest.py')
    return store
  }

  test('sends a file to the Trash rather than deleting it outright', async () => {
    const spy = trashSpy()
    const store = await withSkill(spy.toTrash)

    await store.remove('repro-harness', 'templates/pytest.py')

    // A mistaken click must be recoverable from the OS.
    expect(spy.trashed).toHaveLength(1)
    expect(spy.trashed[0]).toMatch(/templates\/pytest\.py$/)
    expect(store.findAll()[0]?.files).not.toContain('templates/pytest.py')
  })

  test('removes a folder and everything in it', async () => {
    const spy = trashSpy()
    const store = await withSkill(spy.toTrash)

    await store.remove('repro-harness', 'templates')

    const files = store.findAll()[0]?.files ?? []
    expect(files).not.toContain('templates/')
    expect(files).not.toContain('templates/pytest.py')
    expect(files).toContain('SKILL.md')
  })

  test('removes a whole skill', async () => {
    const spy = trashSpy()
    const store = await withSkill(spy.toTrash)

    await store.removeSkill('repro-harness')

    expect(store.findAll()).toEqual([])
    expect(spy.trashed[0]).toMatch(/repro-harness$/)
  })

  test('refuses a path that escapes the skill', async () => {
    const spy = trashSpy()
    const store = await withSkill(spy.toTrash)

    await expect(store.remove('repro-harness', '../../etc')).rejects.toThrow(/outside the skill/)
    expect(spy.trashed).toEqual([])
  })

  test('refuses an absolute path', async () => {
    const spy = trashSpy()
    const store = await withSkill(spy.toTrash)

    await expect(store.remove('repro-harness', '/etc/passwd')).rejects.toThrow(/absolute path/)
    expect(spy.trashed).toEqual([])
  })

  test('refuses to remove the skill folder via an empty relative path', async () => {
    const spy = trashSpy()
    const store = await withSkill(spy.toTrash)

    // removeSkill is the deliberate way to do that; this must not be a
    // back door to it.
    await expect(store.remove('repro-harness', '.')).rejects.toThrow(/name is required/)
    expect(spy.trashed).toEqual([])
  })

  test('says so when the target is already gone', async () => {
    const spy = trashSpy()
    const store = await withSkill(spy.toTrash)

    await expect(store.remove('repro-harness', 'never-existed.md')).rejects.toThrow(
      /no longer there/,
    )
  })

  test('refuses an unknown skill', async () => {
    const spy = trashSpy()
    const store = await withSkill(spy.toTrash)

    await expect(store.removeSkill('ghost')).rejects.toThrow(/unknown skill/)
  })
})

/* --------------------------------------------------- mcp: enablement edits */

describe('withServer', () => {
  test('adds a server the agent did not have', async () => {
    const { withServer } = await import('@main/store/mcp')

    expect(withServer(['github'], 'filesystem', true)).toEqual(['github', 'filesystem'])
  })

  test('removes one it did', async () => {
    const { withServer } = await import('@main/store/mcp')

    expect(withServer(['github', 'filesystem'], 'github', false)).toEqual(['filesystem'])
  })

  test('adding twice does not duplicate it', async () => {
    const { withServer } = await import('@main/store/mcp')

    // Two clicks on the same chip must not write the name twice into
    // agent.toml, which would then launch the server twice.
    const once = withServer([], 'filesystem', true)
    expect(withServer(once, 'filesystem', true)).toEqual(['filesystem'])
  })

  test('removing one that was never there is a no-op', async () => {
    const { withServer } = await import('@main/store/mcp')

    expect(withServer(['github'], 'filesystem', false)).toEqual(['github'])
  })

  test('does not mutate the list it was given', async () => {
    const { withServer } = await import('@main/store/mcp')
    const original = ['github']

    withServer(original, 'filesystem', true)

    expect(original).toEqual(['github'])
  })
})
