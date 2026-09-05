import type {
  Agent,
  Approval,
  McpServer,
  Message,
  ModelInfo,
  Plan,
  PlanComment,
  PlanDocument,
  Project,
  RunnerStatus,
  Session,
  SetupState,
  Skill,
  Status,
  Task,
  TaskComment,
  TaskSessionLink,
  TranscriptLine,
  SpendSummary,
  UpdateState,
  Usage,
} from './types'
import type {
  ImportSummary,
  NotionConnection,
  NotionInspection,
  NotionMapping,
} from './notion'

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
    /**
     * Opens a session. `projectId` files it explicitly — omitted, the agent's
     * own default project decides, and null means none either way.
     */
    create(agentId: string, title?: string, projectId?: string | null): Promise<Session>
    messages(sessionId: string): Promise<Message[]>
    usage(sessionId: string): Promise<Usage | null>
    /**
     * Every spend rollup in one trip: totals per agent (for the grid cards
     * and the sidebar) and per project (for the Spend screen).
     */
    spendSummary(): Promise<SpendSummary>
    send(sessionId: string, prompt: string, options?: SendOptions): Promise<void>
    cancel(sessionId: string): Promise<void>
    /**
     * Confirms, then deletes the session outright: its transcript, its usage,
     * its plans and the link any task held to it all go with it. A turn in
     * flight is stopped first, and its terminal is killed.
     *
     * The confirmation happens in the main process, so a caller in the
     * renderer cannot skip it; a dismissal resolves false rather than
     * rejecting.
     */
    remove(sessionId: string): Promise<boolean>
    /** Files the session under a project, or under none. */
    setProject(sessionId: string, projectId: string | null): Promise<Session>
    /**
     * Names the session, or clears the name with null. A name that is blank
     * once trimmed clears it too — an unnamed session is a state the app
     * renders, not an error it refuses.
     */
    setName(sessionId: string, name: string | null): Promise<Session>
    /**
     * Answers a pending approval. `answers` is only for a question: it is
     * keyed by question text and reaches the tool as its own input, so
     * answering and allowing are one call.
     */
    respondToApproval(
      sessionId: string,
      approvalId: string,
      approved: boolean,
      answers?: Record<string, string>,
    ): Promise<void>
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
    /**
     * Adds a folder the user already has as a skill. Linked, not copied, so
     * it stays the same file on disk.
     */
    link(directory: string): Promise<Skill>
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
  notion: {
    /**
     * Looks at a pasted database URL or id without saving anything: resolves
     * its data source, reads the schema, and guesses a mapping to correct.
     */
    inspect(databaseInput: string): Promise<NotionInspection>
    connect(input: NewConnectionInput): Promise<NotionConnection>
    connections(): Promise<NotionConnection[]>
    /** Pulls the data source onto the board. Push happens on its own. */
    importNow(connectionId: string): Promise<ImportSummary>
    disconnect(id: string): Promise<void>
  }
  projects: {
    /** Every project, archived ones included — the renderer splits them. */
    list(): Promise<Project[]>
    create(input: NewProjectInput): Promise<Project>
    update(id: string, patch: ProjectPatch): Promise<Project>
    /**
     * Puts a project away, or brings it back. Nothing it grouped is lost,
     * which is why this rather than remove is the everyday verb.
     */
    setArchived(id: string, archived: boolean): Promise<Project>
    /** Resolves false when the confirmation dialog was dismissed. */
    remove(id: string): Promise<boolean>
    /**
     * The project's NOTES.md — what it knows that is not a task. Resolves an
     * empty string when nobody has written any yet.
     */
    readNotes(id: string): Promise<string>
    /** Replaces the whole file, as the editor does. Agents only ever append. */
    writeNotes(id: string, contents: string): Promise<void>
    /**
     * Fires when a project's notes change: an agent appending mid-turn, or an
     * edit made in another editor. Without it an open notes editor would show
     * a file that has since moved on.
     */
    onNotesChanged(listener: (payload: ProjectNotesPayload) => void): () => void
  }
  tasks: {
    list(): Promise<Task[]>
    create(input: NewTaskInput): Promise<Task>
    /**
     * The only way a task changes. The actor is decided in the main process,
     * so a renderer cannot log a change as though an agent made it.
     */
    apply(taskId: string, change: TaskChange): Promise<Task>
    /** Resolves false when the confirmation dialog was dismissed. */
    remove(taskId: string): Promise<boolean>
    comments(taskId: string): Promise<TaskComment[]>
    comment(taskId: string, text: string): Promise<TaskComment>
    /**
     * Sessions attached to this task — one per agent that has been mentioned
     * on it, oldest first.
     */
    sessions(taskId: string): Promise<TaskSessionLink[]>
    /** Live board changes — including ones an agent made mid-turn. */
    onEvent(listener: (event: TaskEventPayload) => void): () => void
  }
  plans: {
    /** Every plan this session has proposed, oldest first. */
    listBySession(sessionId: string): Promise<Plan[]>
    /** The plan and the Markdown of its current version. */
    read(planId: string): Promise<PlanDocument>
    comments(planId: string): Promise<PlanComment[]>
    /**
     * Add a note and send it back to the agent, which revises the plan.
     *
     * The actor is decided in the main process, so a renderer cannot file a
     * note as though an agent had written it.
     *
     * `quote` is the passage of the plan the note is about, when you selected
     * one before writing it.
     */
    submit(planId: string, text: string, quote?: string): Promise<Plan>
    /** Accept it: the agent builds it in a worktree and opens a pull request. */
    approve(planId: string): Promise<Plan>
    /** Live plan changes — a revision arriving, or a note from either side. */
    onEvent(listener: (event: PlanEventPayload) => void): () => void
  }
  setup: {
    /** Whether the first-run card is still worth showing, and what it offers. */
    state(): Promise<SetupState>
    /** Puts the card away for good. Resolves the state it leaves behind. */
    dismiss(): Promise<SetupState>
  }
  update: {
    /** Look for a newer release; the result arrives on onStatus. */
    check(): Promise<void>
    /** Fetch the build found by the last check. */
    download(): Promise<void>
    /** Open the downloaded installer. */
    install(): Promise<void>
    /** The running app's version, for the sidebar footer. */
    version(): Promise<string>
    onStatus(listener: (state: UpdateState) => void): () => void
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

/** What the connect modal sends once the mapping has been confirmed. */
export interface NewConnectionInput {
  name: string
  databaseId: string
  dataSourceId: string
  mapping: NotionMapping
  projectId?: string | null
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

/**
 * What the main process broadcasts when a plan changes.
 *
 * Mirrors TaskEventPayload: the store's own event union, republished to every
 * window so an open plan updates while the agent is still rewriting it.
 */
export type PlanEventPayload =
  | { type: 'plan-updated'; plan: Plan }
  | { type: 'comment'; planId: string; comment: PlanComment }

/** One project's notes, as they now stand on disk. */
export interface ProjectNotesPayload {
  projectId: string
  notes: string
}

export type TaskEventPayload =
  | { type: 'task-created'; task: Task }
  | { type: 'task-updated'; task: Task }
  | { type: 'task-deleted'; taskId: string }
  | { type: 'comment'; taskId: string; comment: TaskComment }
  | { type: 'task-session'; taskId: string; link: TaskSessionLink }
  | { type: 'projects'; projects: Project[] }

export interface AgentPatch {
  /**
   * A new display name. The id never changes with it — everything that points
   * at an agent points at the id, so a rename leaves attribution alone.
   */
  name?: string
  runner?: string
  model?: string
  systemPrompt?: string
  skills?: string[]
  mcpServers?: string[]
  cwd?: string
  hidden?: boolean
  /** Null clears the default; omitted leaves it as it is. */
  defaultProjectId?: string | null
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
  /** The project this agent's sessions are filed under. Null for none. */
  defaultProjectId?: string | null
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

/**
 * Mirrors SessionManager's event union across the IPC boundary, plus the one
 * event the manager cannot raise: a session being deleted is not part of a
 * turn, so it is broadcast by the handler that removed it.
 */
export type SessionEventPayload =
  | { type: 'message'; sessionId: string; message: Message }
  | { type: 'message-updated'; sessionId: string; message: Message }
  | { type: 'status'; sessionId: string; status: Status }
  | { type: 'usage'; sessionId: string; usage: Usage }
  | { type: 'approval'; sessionId: string; approval: Approval }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string }
  | { type: 'streaming'; sessionId: string; active: boolean }
  | { type: 'activity'; sessionId: string; text: string }
  | { type: 'session-deleted'; sessionId: string; agentId: string }

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
  sessionsSpendSummary: 'sessions:spendSummary',
  sessionsSend: 'sessions:send',
  sessionsCancel: 'sessions:cancel',
  sessionsDelete: 'sessions:delete',
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
  skillsLink: 'skills:link',
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
  sessionsSetName: 'sessions:setName',

  notionInspect: 'notion:inspect',
  notionConnect: 'notion:connect',
  notionConnections: 'notion:connections',
  notionImport: 'notion:import',
  notionDisconnect: 'notion:disconnect',

  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsSetArchived: 'projects:setArchived',
  projectsDelete: 'projects:delete',
  projectsReadNotes: 'projects:readNotes',
  projectsWriteNotes: 'projects:writeNotes',
  projectsNotesChanged: 'projects:notesChanged', // broadcast, not invoke

  plansListBySession: 'plans:listBySession',
  plansRead: 'plans:read',
  plansComments: 'plans:comments',
  plansSubmit: 'plans:submit',
  plansApprove: 'plans:approve',
  plansEvent: 'plans:event', // broadcast, not invoke

  tasksList: 'tasks:list',
  tasksCreate: 'tasks:create',
  tasksApply: 'tasks:apply',
  tasksDelete: 'tasks:delete',
  tasksComments: 'tasks:comments',
  tasksComment: 'tasks:comment',
  tasksSessions: 'tasks:sessions',
  tasksEvent: 'tasks:event', // broadcast, not invoke

  setupState: 'setup:state',
  setupDismiss: 'setup:dismiss',

  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateVersion: 'update:version',
  updateStatus: 'update:status', // broadcast, not invoke

  dialogChooseDirectory: 'dialog:chooseDirectory',
} as const
