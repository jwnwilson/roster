import type {
  Agent,
  Approval,
  McpServer,
  Message,
  ModelInfo,
  Project,
  RunnerStatus,
  Session,
  Skill,
  Status,
  Task,
  TaskComment,
  TranscriptLine,
  AgentUsage,
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
    /** Every session grouped by agent, for the grid's chip rows. */
    listAll(): Promise<Record<string, Session[]>>
    /** Last few lines of each agent's most recent session, for the grid cards. */
    recentByAgent(): Promise<Record<string, TranscriptLine[]>>
    create(agentId: string, title?: string): Promise<Session>
    messages(sessionId: string): Promise<Message[]>
    usage(sessionId: string): Promise<Usage | null>
    /** Token and cost totals per agent, for the grid cards. */
    usageByAgent(): Promise<Record<string, AgentUsage>>
    send(sessionId: string, prompt: string, options?: SendOptions): Promise<void>
    cancel(sessionId: string): Promise<void>
    /** Files the session under a project, or under none. */
    setProject(sessionId: string, projectId: string | null): Promise<Session>
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
    create(name: string): Promise<Skill>
    /** Creates a file inside a skill; resolves to its absolute path. */
    createFile(skillName: string, relativePath: string): Promise<string>
    createFolder(skillName: string, relativePath: string): Promise<string>
    /** Opens the skill folder in the OS file manager. */
    reveal(name: string): Promise<void>
    /**
     * Confirms, then moves the target to the Trash. Resolves false when the
     * user cancels. Confirmation happens in the main process, so it cannot
     * be skipped by a caller in the renderer.
     */
    remove(skillName: string, relativePath: string): Promise<boolean>
    removeSkill(skillName: string): Promise<boolean>
  }
  mcp: {
    list(): Promise<McpServer[]>
    /** Adds or removes the server from that agent's `mcp_servers`. */
    setEnabled(server: string, agentId: string, enabled: boolean): Promise<Agent>
    install(name: string, command: string): Promise<McpServer[]>
    /** Replaces a configured server's launch command and environment. */
    save(name: string, command: string, env: Record<string, string>): Promise<McpServer[]>
  }
  projects: {
    list(): Promise<Project[]>
    create(input: NewProjectInput): Promise<Project>
    update(id: string, patch: ProjectPatch): Promise<Project>
    remove(id: string): Promise<void>
  }
  tasks: {
    list(): Promise<Task[]>
    create(input: NewTaskInput): Promise<Task>
    /**
     * The only way a task changes. The actor is decided in the main process,
     * so a renderer cannot log a change as though an agent made it.
     */
    apply(taskId: string, change: TaskChange): Promise<Task>
    remove(taskId: string): Promise<void>
    comments(taskId: string): Promise<TaskComment[]>
    comment(taskId: string, text: string): Promise<TaskComment>
    /** Live board changes — including ones an agent made mid-turn. */
    onEvent(listener: (event: TaskEventPayload) => void): () => void
  }
  dialog: {
    /** Native directory picker; resolves null when cancelled. */
    chooseDirectory(current?: string): Promise<string | null>
  }
}

/** Per-turn choices, decided at send time rather than in agent.toml. */
export interface SendOptions {
  /**
   * Research and propose only. The runner refuses edits for the whole turn
   * and the agent ends by proposing a plan, which arrives as an approval.
   */
  planMode?: boolean
}

export interface NewProjectInput {
  name: string
  color: string
  description?: string
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'color' | 'description'>>

export interface NewTaskInput {
  title: string
  description?: string
  status?: Task['status']
  priority?: Task['priority']
  assigneeId?: string | null
  projectId?: string | null
  labels?: string[]
}

/** One field of one task, changing. Mirrors the store's own TaskChange. */
export type TaskChange =
  | { field: 'status'; value: Task['status'] }
  | { field: 'priority'; value: Task['priority'] }
  | { field: 'assignee'; value: string | null }
  | { field: 'project'; value: string | null }
  | { field: 'title'; value: string }
  | { field: 'description'; value: string }
  | { field: 'addLabel'; value: string }
  | { field: 'removeLabel'; value: string }

export type TaskEventPayload =
  | { type: 'task-created'; task: Task }
  | { type: 'task-updated'; task: Task }
  | { type: 'task-deleted'; taskId: string }
  | { type: 'comment'; taskId: string; comment: TaskComment }
  | { type: 'projects'; projects: Project[] }

export interface AgentPatch {
  runner?: string
  model?: string
  systemPrompt?: string
  skills?: string[]
  mcpServers?: string[]
  cwd?: string
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
  /** Output so far, replayed when a pane is reopened. */
  history: string
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
  | { type: 'activity'; sessionId: string; text: string }

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
  sessionsRecentByAgent: 'sessions:recentByAgent',
  sessionsListAll: 'sessions:listAll',
  sessionsCreate: 'sessions:create',
  sessionsMessages: 'sessions:messages',
  sessionsUsage: 'sessions:usage',
  sessionsUsageByAgent: 'sessions:usageByAgent',
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
  skillsCreate: 'skills:create',
  skillsCreateFile: 'skills:createFile',
  skillsCreateFolder: 'skills:createFolder',
  skillsRemove: 'skills:remove',
  skillsRemoveSkill: 'skills:removeSkill',
  skillsReveal: 'skills:reveal',

  mcpList: 'mcp:list',
  mcpSetEnabled: 'mcp:setEnabled',
  mcpInstall: 'mcp:install',
  mcpSave: 'mcp:save',

  sessionsSetProject: 'sessions:setProject',

  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsDelete: 'projects:delete',

  tasksList: 'tasks:list',
  tasksCreate: 'tasks:create',
  tasksApply: 'tasks:apply',
  tasksDelete: 'tasks:delete',
  tasksComments: 'tasks:comments',
  tasksComment: 'tasks:comment',
  tasksEvent: 'tasks:event', // broadcast, not invoke

  dialogChooseDirectory: 'dialog:chooseDirectory',
} as const
