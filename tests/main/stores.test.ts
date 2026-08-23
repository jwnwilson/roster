import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDatabase, type Db } from '@main/db'
import { McpStore } from '@main/store/mcp'
import { SessionStore } from '@main/store/sessions'
import { SkillStore } from '@main/store/skills'
import { UsageStore, contextWindowFor } from '@main/store/usage'
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
      costUsd: 0.5,
      contextUsed: 0.25,
    })

    expect(store.forSession(s.id)).toEqual({
      sessionId: s.id,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.5,
      contextUsed: 0.25,
    })
  })

  test('replaces rather than accumulates, since runners report totals', () => {
    const s = sessions.create({ agentId: 'a', title: 'x', origin: 'you' })
    store.record({ sessionId: s.id, inputTokens: 10, outputTokens: 5, costUsd: 0.5, contextUsed: 0 })
    store.record({ sessionId: s.id, inputTokens: 30, outputTokens: 9, costUsd: 1.5, contextUsed: 0 })

    expect(store.forSession(s.id)).toMatchObject({ inputTokens: 30, costUsd: 1.5 })
  })

  test('totals every session an agent owns, for its grid card', () => {
    const a = sessions.create({ agentId: 'debugging', title: '1', origin: 'you' })
    const b = sessions.create({ agentId: 'debugging', title: '2', origin: 'you' })
    const other = sessions.create({ agentId: 'review', title: '3', origin: 'you' })

    store.record({ sessionId: a.id, inputTokens: 10, outputTokens: 5, costUsd: 1, contextUsed: 0 })
    store.record({ sessionId: b.id, inputTokens: 20, outputTokens: 5, costUsd: 2, contextUsed: 0 })
    store.record({ sessionId: other.id, inputTokens: 99, outputTokens: 0, costUsd: 9, contextUsed: 0 })

    expect(store.forAgent('debugging')).toEqual({ tokens: 40, costUsd: 3 })
  })

  test('an agent with no usage totals to zero rather than null', () => {
    expect(store.forAgent('nobody')).toEqual({ tokens: 0, costUsd: 0 })
  })
})

describe('contextWindowFor', () => {
  test('knows the models Roster ships with', () => {
    expect(contextWindowFor('claude-opus-5')).toBe(1_000_000)
    expect(contextWindowFor('claude-haiku-4-5')).toBe(200_000)
  })

  test('reports nothing for an unknown model rather than guessing', () => {
    expect(contextWindowFor('some-future-model')).toBeNull()
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

  test('reads servers and their per-agent wiring', async () => {
    await writeConfig({
      servers: [{ name: 'filesystem', command: 'npx fs', enabledFor: ['debugging'] }],
    })

    const store = new McpStore()
    await store.load()

    expect(store.findAll()).toEqual([
      { name: 'filesystem', command: 'npx fs', enabledFor: ['debugging'] },
    ])
  })

  test('fills in defaults for a partially written entry', async () => {
    await writeConfig({ servers: [{ name: 'partial' }] })

    const store = new McpStore()
    await store.load()

    expect(store.findAll()[0]).toEqual({ name: 'partial', command: '', enabledFor: [] })
  })

  test('enabling a server for an agent persists to disk', async () => {
    await writeConfig({ servers: [{ name: 'filesystem', command: 'npx fs', enabledFor: [] }] })
    const store = new McpStore()
    await store.load()

    await store.setEnabled('filesystem', 'debugging', true)

    const reopened = new McpStore()
    await reopened.load()
    expect(reopened.findAll()[0]?.enabledFor).toEqual(['debugging'])
  })

  test('disabling removes just that agent', async () => {
    await writeConfig({
      servers: [{ name: 'filesystem', command: 'npx fs', enabledFor: ['debugging', 'review'] }],
    })
    const store = new McpStore()
    await store.load()

    await store.setEnabled('filesystem', 'debugging', false)
    expect(store.findAll()[0]?.enabledFor).toEqual(['review'])
  })

  test('enabling twice does not duplicate the agent', async () => {
    await writeConfig({ servers: [{ name: 'filesystem', command: 'npx fs', enabledFor: [] }] })
    const store = new McpStore()
    await store.load()

    await store.setEnabled('filesystem', 'debugging', true)
    await store.setEnabled('filesystem', 'debugging', true)

    expect(store.findAll()[0]?.enabledFor).toEqual(['debugging'])
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
