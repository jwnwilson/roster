import type { Agent } from '@shared/types'

/** A minimal agent record, for tests that only care about id and name. */
export function anAgentRecord(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'debugging',
    name: 'Debugging Agent',
    runner: 'claude',
    model: 'claude-opus-5',
    cwd: '/tmp/work',
    cwdLabel: '~/work',
    systemPrompt: '',
    skills: [],
    mcpServers: [],
    status: 'idle',
    ...overrides,
  }
}
