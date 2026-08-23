import type {
  Agent,
  Approval,
  McpServer,
  Message,
  ModelInfo,
  RunnerStatus,
  Session,
  Skill,
  Status,
  Usage,
} from './types'

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
    models(runnerId: string): Promise<ModelInfo[]>
  }
  agents: {
    list(): Promise<Agent[]>
    get(id: string): Promise<Agent | null>
    create(input: NewAgentInput): Promise<Agent>
    update(id: string, patch: AgentPatch): Promise<Agent>
    /** Fires when an agent.toml changes on disk, including external edits. */
    onChanged(listener: (agents: Agent[]) => void): () => void
  }
  sessions: {
    listByAgent(agentId: string): Promise<Session[]>
    create(agentId: string, title?: string): Promise<Session>
    messages(sessionId: string): Promise<Message[]>
    usage(sessionId: string): Promise<Usage | null>
    send(sessionId: string, prompt: string): Promise<void>
    cancel(sessionId: string): Promise<void>
    respondToApproval(sessionId: string, approvalId: string, approved: boolean): Promise<void>
    pendingApprovals(sessionId: string): Promise<Approval[]>
    /** Live turn events: messages, status, usage, approvals. */
    onEvent(listener: (event: SessionEventPayload) => void): () => void
  }
  pty: {
    open(sessionId: string, cwd: string, size: PtySize): Promise<PtyInfo>
    write(sessionId: string, data: string): void
    resize(sessionId: string, size: PtySize): void
    close(sessionId: string): void
    onData(listener: (payload: { sessionId: string; data: string }) => void): () => void
    onExit(listener: (payload: { sessionId: string; code: number }) => void): () => void
  }
  skills: {
    list(): Promise<Skill[]>
    read(path: string): Promise<string>
    write(path: string, contents: string): Promise<void>
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

export interface NewAgentInput {
  name: string
  runner: string
  model: string
  systemPrompt: string
  skills: string[]
  /** Defaults to ~/roster/workspace when omitted. */
  cwd?: string
  mcpServers?: string[]
}

export interface PtySize {
  cols: number
  rows: number
}

export interface PtyInfo {
  shell: string
  cwd: string
}

/** Mirrors SessionManager's event union across the IPC boundary. */
export type SessionEventPayload =
  | { type: 'message'; sessionId: string; message: Message }
  | { type: 'message-updated'; sessionId: string; message: Message }
  | { type: 'status'; sessionId: string; status: Status }
  | { type: 'usage'; sessionId: string; usage: Usage }
  | { type: 'approval'; sessionId: string; approval: Approval }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string }
  | { type: 'streaming'; sessionId: string; active: boolean }

/** Channel names, kept in one place so main and preload cannot drift. */
export const CHANNELS = {
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',

  runnersList: 'runners:list',
  runnersModels: 'runners:models',

  agentsList: 'agents:list',
  agentsGet: 'agents:get',
  agentsCreate: 'agents:create',
  agentsUpdate: 'agents:update',
  agentsChanged: 'agents:changed',

  sessionsListByAgent: 'sessions:listByAgent',
  sessionsCreate: 'sessions:create',
  sessionsMessages: 'sessions:messages',
  sessionsUsage: 'sessions:usage',
  sessionsSend: 'sessions:send',
  sessionsCancel: 'sessions:cancel',
  sessionsRespondToApproval: 'sessions:respondToApproval',
  sessionsPendingApprovals: 'sessions:pendingApprovals',
  sessionsEvent: 'sessions:event',

  ptyOpen: 'pty:open',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyClose: 'pty:close',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',

  skillsList: 'skills:list',
  skillsRead: 'skills:read',
  skillsWrite: 'skills:write',

  mcpList: 'mcp:list',
  mcpSetEnabled: 'mcp:setEnabled',
} as const
