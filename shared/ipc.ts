import type { Agent, McpServer, Message, RunnerStatus, Session, Skill, Usage } from './types'

/**
 * The contract exposed on `window.roster`. The renderer may only reach the
 * main process through these calls — no node, no fs, no child processes.
 */
export interface RosterApi {
  window: {
    minimize(): void
    maximize(): void
    close(): void
  }
  runners: {
    list(): Promise<RunnerStatus[]>
  }
  agents: {
    list(): Promise<Agent[]>
    get(id: string): Promise<Agent | null>
    update(id: string, patch: AgentPatch): Promise<Agent>
    /** Fires when an agent.toml changes on disk, including external edits. */
    onChanged(listener: (agents: Agent[]) => void): () => void
  }
  sessions: {
    listByAgent(agentId: string): Promise<Session[]>
    messages(sessionId: string): Promise<Message[]>
    usage(sessionId: string): Promise<Usage | null>
  }
  skills: {
    list(): Promise<Skill[]>
    read(path: string): Promise<string>
  }
  mcp: {
    list(): Promise<McpServer[]>
    setEnabled(server: string, agentId: string, enabled: boolean): Promise<void>
  }
}

export interface AgentPatch {
  runner?: string
  model?: string
  systemPrompt?: string
  skills?: string[]
  mcpServers?: string[]
}

/** Channel names, kept in one place so main and preload cannot drift. */
export const CHANNELS = {
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  runnersList: 'runners:list',
  agentsList: 'agents:list',
  agentsGet: 'agents:get',
  agentsUpdate: 'agents:update',
  agentsChanged: 'agents:changed',
  sessionsListByAgent: 'sessions:listByAgent',
  sessionsMessages: 'sessions:messages',
  sessionsUsage: 'sessions:usage',
  skillsList: 'skills:list',
  skillsRead: 'skills:read',
  mcpList: 'mcp:list',
  mcpSetEnabled: 'mcp:setEnabled',
} as const
