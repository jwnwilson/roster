import type {
  Agent,
  McpServer,
  Project,
  RunnerStatus,
  Session,
  Skill,
  Task,
  TaskComment,
} from '@shared/types'

/** Test fixtures. Each takes overrides so a test states only what it cares about. */

export function anAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'debugging',
    name: 'Debugging Agent',
    runner: 'claude',
    model: 'claude-opus-5',
    cwd: '/Users/test/work/api',
    cwdLabel: '~/work/api',
    systemPrompt: 'Reproduce before you fix.',
    skills: ['repro-harness'],
    mcpServers: ['filesystem'],
    status: 'idle',
    ...overrides,
  }
}

export function aSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    agentId: 'debugging',
    title: 'Session leak on 504',
    origin: 'you',
    status: 'idle',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

export function aRunner(overrides: Partial<RunnerStatus> = {}): RunnerStatus {
  return {
    id: 'claude',
    provider: 'Anthropic',
    installed: true,
    ready: true,
    auth: 'subscription',
    ...overrides,
  }
}

export function aSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'repro-harness',
    path: '/Users/test/roster/skills/repro-harness',
    files: ['SKILL.md'],
    lastEditedMs: 1_700_000_000_000,
    ...overrides,
  }
}

export function anMcpServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    name: 'filesystem',
    command: 'npx @modelcontextprotocol/server-filesystem ~',
    env: {},
    ...overrides,
  }
}

export function aProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-reliability',
    name: 'API reliability',
    color: 'var(--color-project-4)',
    description: 'Close out connection-handling bugs.',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

export function aTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'ROS-101',
    title: 'Fix connection pool leak on 504',
    description: 'Pool never releases the connection when the upstream returns 504.',
    status: 'todo',
    priority: 'medium',
    assigneeId: null,
    projectId: null,
    labels: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

export function aTaskComment(overrides: Partial<TaskComment> = {}): TaskComment {
  return {
    id: 'comment-1',
    taskId: 'ROS-101',
    author: 'you',
    tone: 'you',
    text: 'Reproduces about every 90s.',
    isSystem: false,
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}
