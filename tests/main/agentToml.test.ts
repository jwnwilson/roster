import { describe, expect, test } from 'vitest'
import { parseAgentToml, serializeAgentToml, AgentConfigError } from '@main/store/agentToml'

const VALID = `
name = "Debugging Agent"
runner = "claude"
model = "claude-opus-5"
cwd = "~/work/api"
system_prompt = "Reproduce before you fix."
skills = ["repro-harness", "stack-triage"]
mcp_servers = ["filesystem", "postgres"]
`

describe('parseAgentToml', () => {
  test('reads a complete config', () => {
    const cfg = parseAgentToml('debug', VALID)

    expect(cfg.id).toBe('debug')
    expect(cfg.name).toBe('Debugging Agent')
    expect(cfg.runner).toBe('claude')
    expect(cfg.model).toBe('claude-opus-5')
    expect(cfg.systemPrompt).toBe('Reproduce before you fix.')
    expect(cfg.skills).toEqual(['repro-harness', 'stack-triage'])
    expect(cfg.mcpServers).toEqual(['filesystem', 'postgres'])
  })

  test('expands a leading ~ in cwd to the home directory', () => {
    const cfg = parseAgentToml('debug', VALID)
    expect(cfg.cwd.startsWith('~')).toBe(false)
    expect(cfg.cwd.endsWith('/work/api')).toBe(true)
  })

  test('defaults the optional list fields to empty', () => {
    const cfg = parseAgentToml('x', 'name = "A"\nrunner = "claude"\nmodel = "m"\ncwd = "/tmp"\n')
    expect(cfg.skills).toEqual([])
    expect(cfg.mcpServers).toEqual([])
    expect(cfg.systemPrompt).toBe('')
  })

  test('rejects a config missing a required field', () => {
    // A hand-edited file that lost its model line.
    const bad = 'name = "A"\nrunner = "claude"\ncwd = "/tmp"\n'
    expect(() => parseAgentToml('x', bad)).toThrow(AgentConfigError)
    expect(() => parseAgentToml('x', bad)).toThrow(/model/)
  })

  test('rejects malformed TOML with the agent id in the message', () => {
    expect(() => parseAgentToml('debug', 'name = = "A"')).toThrow(/debug/)
  })

  test('rejects a non-string entry inside skills', () => {
    const bad = 'name = "A"\nrunner = "claude"\nmodel = "m"\ncwd = "/tmp"\nskills = ["ok", 3]\n'
    expect(() => parseAgentToml('x', bad)).toThrow(/skills/)
  })

  test('requires a [custom] block when the runner is not builtin', () => {
    const bad = 'name = "A"\nrunner = "my-cli"\nmodel = "m"\ncwd = "/tmp"\n'
    expect(() => parseAgentToml('x', bad)).toThrow(/custom/)
  })

  test('accepts a custom runner that supplies a command', () => {
    const cfg = parseAgentToml(
      'x',
      'name = "A"\nrunner = "my-cli"\nmodel = "m"\ncwd = "/tmp"\n' +
        '[custom]\ncommand = "gemini"\nargs = ["-p", "{prompt}"]\n',
    )
    expect(cfg.custom).toEqual({ command: 'gemini', args: ['-p', '{prompt}'] })
  })
})

describe('serializeAgentToml', () => {
  test('round-trips a config without losing fields', () => {
    const original = parseAgentToml('debug', VALID)
    const reparsed = parseAgentToml('debug', serializeAgentToml(original))

    expect(reparsed).toEqual(original)
  })

  test('writes cwd back with the home directory re-collapsed to ~', () => {
    const cfg = parseAgentToml('debug', VALID)
    expect(serializeAgentToml(cfg)).toContain('cwd = "~/work/api"')
  })

  test('round-trips a multi-line system prompt', () => {
    const cfg = parseAgentToml('debug', VALID)
    const withNewlines = { ...cfg, systemPrompt: 'Line one.\nLine two.\n\nLine four.' }

    const reparsed = parseAgentToml('debug', serializeAgentToml(withNewlines))
    expect(reparsed.systemPrompt).toBe('Line one.\nLine two.\n\nLine four.')
  })

  test('round-trips a custom runner block', () => {
    const cfg = parseAgentToml(
      'x',
      'name = "A"\nrunner = "my-cli"\nmodel = "m"\ncwd = "/tmp"\n' +
        '[custom]\ncommand = "gemini"\nargs = ["-p"]\n',
    )
    expect(parseAgentToml('x', serializeAgentToml(cfg))).toEqual(cfg)
  })
})
