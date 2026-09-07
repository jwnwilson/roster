import { describe, expect, test } from 'vitest'
import {
  BUNDLE_VERSION,
  BundleError,
  parseBundle,
  serializeBundle,
  type AgentBundle,
} from '@main/store/agentBundle'

function aBundle(overrides: Partial<AgentBundle> = {}): AgentBundle {
  return {
    version: BUNDLE_VERSION,
    agent: {
      name: 'Reviewer',
      runner: 'claude',
      model: 'claude-sonnet-5',
      systemPrompt: 'Correctness first, style last.',
      skills: ['pr-review'],
      mcpServers: ['tasks', 'linear'],
    },
    skills: [{ name: 'pr-review', body: '---\nname: pr-review\n---\n\n# PR Review\n' }],
    mcpServers: [
      { name: 'linear', command: 'npx server-linear', envKeys: ['LINEAR_API_KEY'] },
    ],
    ...overrides,
  }
}

describe('serializeBundle', () => {
  test('round-trips through parseBundle', () => {
    const bundle = aBundle()

    expect(parseBundle(serializeBundle(bundle))).toEqual(bundle)
  })

  test('carries the skill body, so the recipient does not need the skill already', () => {
    expect(serializeBundle(aBundle())).toContain('# PR Review')
  })

  test('names the environment a server needs without carrying its value', () => {
    // mcp.json stores environments in the clear. An export that took them
    // would turn "share my agent" into publishing an API token.
    const text = serializeBundle(aBundle())

    expect(text).toContain('LINEAR_API_KEY')
    expect(text).not.toContain('secret')
  })

  test('lists a built-in server as enabled without inventing a command for it', () => {
    // Built-ins run inside Roster; the recipient already has them.
    const text = serializeBundle(aBundle())
    const parsed = parseBundle(text)

    expect(parsed.agent.mcpServers).toContain('tasks')
    expect(parsed.mcpServers.map((s) => s.name)).not.toContain('tasks')
  })

  test('carries a custom runner’s command, since the agent is nothing without it', () => {
    const bundle = aBundle({
      agent: { ...aBundle().agent, runner: 'ollama-codex', custom: { command: 'codex', args: ['-m'] } },
    })

    expect(parseBundle(serializeBundle(bundle)).agent.custom).toEqual({
      command: 'codex',
      args: ['-m'],
    })
  })
})

describe('parseBundle — a bundle is untrusted input', () => {
  test('rejects text that is not TOML at all', () => {
    expect(() => parseBundle('this is not toml {{{')).toThrow(BundleError)
  })

  test('rejects a version it does not know, rather than guessing the shape', () => {
    const text = serializeBundle(aBundle()).replace(`version = ${BUNDLE_VERSION}`, 'version = 99')

    expect(() => parseBundle(text)).toThrow(/version/i)
  })

  test('names the field that is missing', () => {
    expect(() => parseBundle('version = 1\n[agent]\nname = "x"\n')).toThrow(/runner/)
  })

  test('rejects a skill name that would escape the library', () => {
    const bundle = aBundle({
      agent: { ...aBundle().agent, skills: ['../../.ssh/authorized_keys'] },
      skills: [{ name: '../../.ssh/authorized_keys', body: 'ssh-rsa ...' }],
    })

    expect(() => parseBundle(serializeBundle(bundle))).toThrow(/name/)
  })

  test('rejects a skill name with a path separator in it', () => {
    const bundle = aBundle({
      agent: { ...aBundle().agent, skills: ['a/b'] },
      skills: [{ name: 'a/b', body: 'x' }],
    })

    expect(() => parseBundle(serializeBundle(bundle))).toThrow(/name/)
  })

  test('rejects an mcp server name that is not a plain name either', () => {
    const bundle = aBundle({
      mcpServers: [{ name: '../evil', command: 'x', envKeys: [] }],
    })

    expect(() => parseBundle(serializeBundle(bundle))).toThrow(/name/)
  })

  test('drops an env value someone added to a bundle by hand', () => {
    // The format has no place for one, but a hand-edited file might. It must
    // not reach mcp.json just because it was written there.
    const text = `${serializeBundle(aBundle())}\n[bundle_env]\nLINEAR_API_KEY = "secret"\n`

    expect(JSON.stringify(parseBundle(text))).not.toContain('secret')
  })

  test('refuses a skill the agent does not enable, which nothing would install', () => {
    const bundle = aBundle({
      agent: { ...aBundle().agent, skills: [] },
      skills: [{ name: 'unlisted', body: 'x' }],
    })

    expect(() => parseBundle(serializeBundle(bundle))).toThrow(/unlisted/)
  })

  test('refuses an enabled skill the bundle carries no body for', () => {
    const bundle = aBundle({ skills: [] })

    expect(() => parseBundle(serializeBundle(bundle))).toThrow(/pr-review/)
  })

  test('accepts an agent with no skills and no servers', () => {
    const bundle = aBundle({
      agent: { ...aBundle().agent, skills: [], mcpServers: [] },
      skills: [],
      mcpServers: [],
    })

    expect(parseBundle(serializeBundle(bundle)).agent.skills).toEqual([])
  })
})

describe('the bundle deliberately does not carry', () => {
  test('a working directory, which is a path on the sender’s machine', () => {
    expect(serializeBundle(aBundle())).not.toContain('cwd')
  })

  test('a default project, whose id means nothing on another install', () => {
    expect(serializeBundle(aBundle())).not.toContain('default_project')
  })
})
