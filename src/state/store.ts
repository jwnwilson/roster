import { create } from 'zustand'
import type {
  Agent,
  AgentUsage,
  Approval,
  McpServer,
  Message,
  Project,
  RunnerStatus,
  Session,
  Skill,
  Status,
  Task,
  TaskComment,
  TaskStatus,
  TranscriptLine,
  Usage,
} from '@shared/types'
import type { SessionEventPayload, TaskEventPayload } from '@shared/ipc'
import { rollUpAgentStatus } from '@shared/status'
import { TASK_STATUSES } from '@shared/types'
import { messageFor } from '@/lib/errors'

export type Screen = 'grid' | 'agent' | 'skills' | 'mcp' | 'new' | 'tasks'
export type PaneMode = 'chat' | 'terminal'
export type McpTab = 'installed' | 'registry'
export type TaskTab = 'comments' | 'history'

/** The project filter's "no filter" value, in both the grid and the board. */
export const ALL_PROJECTS = 'all'

/** Staged edits from the Edit modal, committed to the agent only on Save. */
export interface Draft {
  runner: string
  model: string
  systemPrompt: string
  skills: Record<string, boolean>
  mcp: Record<string, boolean>
  /** Absolute path, with a display label alongside it. */
  cwd: string
  cwdLabel: string
}

interface RosterState {
  /* ---- loaded data ------------------------------------------------- */
  agents: Agent[]
  runners: RunnerStatus[]
  skills: Skill[]
  mcpServers: McpServer[]
  sessions: Record<string, Session[]>
  /** sessionId -> transcript, loaded on demand. */
  messages: Record<string, Message[]>
  /** sessionId -> a turn is in flight. */
  streaming: Record<string, boolean>
  /** sessionId -> what the agent is doing, for the streaming indicator. */
  activity: Record<string, string>
  /** sessionId -> approvals the runner is blocked on. */
  approvals: Record<string, Approval[]>
  usage: Record<string, Usage>
  /** Token and cost totals per agent, for the grid cards. */
  agentUsage: Record<string, AgentUsage>
  /** agentId -> the last few lines of its most recent session. */
  transcripts: Record<string, TranscriptLine[]>
  projects: Project[]
  tasks: Task[]
  /** taskId -> its thread, loaded when the task is opened. */
  taskComments: Record<string, TaskComment[]>
  loaded: boolean

  /* ---- navigation --------------------------------------------------- */
  screen: Screen
  agentId: string | null
  /** agentId -> sessionId, so switching agents preserves each one's session. */
  sess: Record<string, string>
  mode: PaneMode
  mcpTab: McpTab

  /* ---- transient UI ------------------------------------------------- */
  openTools: Record<string, boolean>
  /**
   * Sessions whose next turn runs in plan mode, keyed by session id.
   *
   * A per-turn choice rather than agent configuration, so it lives here and
   * not in agent.toml — and per session, since planning one piece of work
   * says nothing about the tab beside it.
   */
  planMode: Record<string, boolean>
  query: string
  gridQuery: string
  editOpen: boolean
  draft: Draft | null

  /* ---- Tasks board -------------------------------------------------- */
  /** The task whose detail modal is open. */
  openTaskId: string | null
  taskQuery: string
  taskTab: TaskTab
  /**
   * ALL_PROJECTS, or a project id.
   *
   * One filter for the whole app, not one per screen: picking a project is a
   * statement about what you are looking at, and it should still hold when
   * you move from the board to the grid.
   */
  projectFilter: string
  projectsOpen: boolean
  newTaskOpen: boolean

  /* ---- New Agent form ---------------------------------------------- */
  newRunner: string
  newModel: string
  newPrompt: string
  picked: Record<string, boolean>

  /* ---- actions ------------------------------------------------------ */
  hydrate(data: Pick<RosterState, 'agents' | 'runners' | 'skills' | 'mcpServers'>): void
  setAgents(agents: Agent[]): void
  setSessions(agentId: string, sessions: Session[]): void
  setMessages(sessionId: string, messages: Message[]): void
  setUsage(sessionId: string, usage: Usage): void
  setAgentUsage(totals: Record<string, AgentUsage>): void
  setTranscripts(transcripts: Record<string, TranscriptLine[]>): void
  setAllSessions(sessions: Record<string, Session[]>): void
  setMcpServers(servers: McpServer[]): void
  setSkills(skills: Skill[]): void
  setProjects(projects: Project[]): void
  setTasks(tasks: Task[]): void
  setTaskComments(taskId: string, comments: TaskComment[]): void
  /** Applies one live board change from the main process. */
  applyTaskEvent(event: TaskEventPayload): void
  /** Applies one live event from the main process. */
  applySessionEvent(event: SessionEventPayload): void

  go(screen: Screen): void
  openAgent(agentId: string, sessionId?: string): void
  selectSession(agentId: string, sessionId: string): void
  setMode(mode: PaneMode): void
  setMcpTab(tab: McpTab): void

  toggleTool(id: string): void
  togglePlanMode(sessionId: string): void
  setPlanMode(sessionId: string, on: boolean): void
  setQuery(value: string): void
  setGridQuery(value: string): void
  setTaskQuery(value: string): void
  setTaskTab(tab: TaskTab): void
  setProjectFilter(value: string): void
  openTask(taskId: string): void
  closeTask(): void
  setProjectsOpen(open: boolean): void
  setNewTaskOpen(open: boolean): void

  openEdit(): void
  cancelEdit(): void
  patchDraft(patch: Partial<Draft>): void
  toggleDraftSkill(name: string): void
  toggleDraftMcp(name: string): void

  setNewRunner(runner: string): void
  setNewModel(model: string): void
  setNewPrompt(value: string): void
  togglePicked(name: string): void
}

export const useRoster = create<RosterState>((set, get) => ({
  agents: [],
  runners: [],
  skills: [],
  mcpServers: [],
  sessions: {},
  messages: {},
  streaming: {},
  activity: {},
  approvals: {},
  usage: {},
  agentUsage: {},
  transcripts: {},
  projects: [],
  tasks: [],
  taskComments: {},
  loaded: false,

  screen: 'grid',
  agentId: null,
  sess: {},
  mode: 'chat',
  mcpTab: 'installed',

  openTools: {},
  planMode: {},
  query: '',
  gridQuery: '',
  editOpen: false,
  draft: null,

  openTaskId: null,
  taskQuery: '',
  taskTab: 'comments',
  projectFilter: ALL_PROJECTS,
  projectsOpen: false,
  newTaskOpen: false,

  newRunner: 'claude',
  newModel: '',
  newPrompt: '',
  picked: {},

  hydrate: (data) => set({ ...data, loaded: true }),
  setAgents: (agents) => set({ agents }),
  setSessions: (agentId, sessions) =>
    set((s) => ({ sessions: { ...s.sessions, [agentId]: sessions } })),

  setMessages: (sessionId, messages) =>
    set((s) => ({ messages: { ...s.messages, [sessionId]: messages } })),

  setUsage: (sessionId, usage) => set((s) => ({ usage: { ...s.usage, [sessionId]: usage } })),
  setAgentUsage: (agentUsage) => set({ agentUsage }),
  setTranscripts: (transcripts) => set({ transcripts }),
  setAllSessions: (sessions) => set({ sessions }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setSkills: (skills) => set({ skills }),
  setProjects: (projects) => set({ projects }),
  setTasks: (tasks) => set({ tasks }),
  setTaskComments: (taskId, comments) =>
    set((s) => ({ taskComments: { ...s.taskComments, [taskId]: comments } })),

  applySessionEvent: (event) => set((s) => reduceSessionEvent(s, event)),
  applyTaskEvent: (event) => set((s) => reduceTaskEvent(s, event)),

  go: (screen) => set({ screen }),

  openAgent: (agentId, sessionId) =>
    set((s) => ({
      screen: 'agent',
      agentId,
      sess: sessionId ? { ...s.sess, [agentId]: sessionId } : s.sess,
    })),

  selectSession: (agentId, sessionId) =>
    set((s) => ({ sess: { ...s.sess, [agentId]: sessionId } })),

  setMode: (mode) => set({ mode }),
  setMcpTab: (mcpTab) => set({ mcpTab }),

  toggleTool: (id) => set((s) => ({ openTools: { ...s.openTools, [id]: !s.openTools[id] } })),
  togglePlanMode: (sessionId) =>
    set((s) => ({ planMode: { ...s.planMode, [sessionId]: !s.planMode[sessionId] } })),
  setPlanMode: (sessionId, on) =>
    set((s) => ({ planMode: { ...s.planMode, [sessionId]: on } })),
  setQuery: (query) => set({ query }),
  setGridQuery: (gridQuery) => set({ gridQuery }),
  setTaskQuery: (taskQuery) => set({ taskQuery }),
  setTaskTab: (taskTab) => set({ taskTab }),
  setProjectFilter: (projectFilter) => set({ projectFilter }),

  // Every task opens on Comments: History is a record you go looking for,
  // not the first thing you want to read.
  openTask: (openTaskId) => set({ openTaskId, taskTab: 'comments' }),
  closeTask: () => set({ openTaskId: null }),
  setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
  setNewTaskOpen: (newTaskOpen) => set({ newTaskOpen }),

  /** Snapshots the agent's live config into a draft; nothing is committed yet. */
  openEdit: () => {
    const { agents, agentId } = get()
    const agent = agents.find((a) => a.id === agentId)
    if (!agent) return

    set({
      editOpen: true,
      draft: {
        runner: agent.runner,
        model: agent.model,
        systemPrompt: agent.systemPrompt,
        skills: Object.fromEntries(agent.skills.map((name) => [name, true])),
        mcp: Object.fromEntries(agent.mcpServers.map((name) => [name, true])),
        cwd: agent.cwd,
        cwdLabel: agent.cwdLabel,
      },
    })
  },

  cancelEdit: () => set({ editOpen: false, draft: null }),

  patchDraft: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : {})),

  toggleDraftSkill: (name) =>
    set((s) =>
      s.draft ? { draft: { ...s.draft, skills: { ...s.draft.skills, [name]: !s.draft.skills[name] } } } : {},
    ),

  toggleDraftMcp: (name) =>
    set((s) =>
      s.draft ? { draft: { ...s.draft, mcp: { ...s.draft.mcp, [name]: !s.draft.mcp[name] } } } : {},
    ),

  setNewRunner: (newRunner) => set({ newRunner }),
  setNewModel: (newModel) => set({ newModel }),
  setNewPrompt: (newPrompt) => set({ newPrompt }),
  togglePicked: (name) => set((s) => ({ picked: { ...s.picked, [name]: !s.picked[name] } })),
}))

/* ---------------------------------------------------------------------
 * Selectors — filtering lives here so screens stay presentational.
 *
 * Any selector that builds a new array must be read through `useShallow`,
 * or zustand v5 sees a fresh reference on every render and loops forever.
 * ------------------------------------------------------------------ */

/** Shared empty array so "no sessions" is a stable reference. */
export const NO_SESSIONS: readonly Session[] = Object.freeze([])

/** Likewise for an agent that has not said anything yet. */
export const NO_LINES: readonly TranscriptLine[] = Object.freeze([])

export function selectSidebarAgents(state: RosterState): Agent[] {
  const q = state.query.trim().toLowerCase()
  if (q === '') return state.agents
  return state.agents.filter((a) => a.name.toLowerCase().includes(q))
}

/**
 * The sessions a project filter leaves visible.
 *
 * Exported because the grid needs the same answer twice — once to decide
 * whether a card shows at all, once to decide which chips it shows. Two
 * copies of this predicate would eventually disagree, and a card would
 * render with no chips in it.
 */
export function sessionsInProject(
  sessions: readonly Session[],
  projectFilter: string,
): readonly Session[] {
  if (projectFilter === ALL_PROJECTS) return sessions
  return sessions.filter((session) => session.projectId === projectFilter)
}

export function selectGridAgents(state: RosterState): Agent[] {
  const q = state.gridQuery.trim().toLowerCase()
  const project = state.projectFilter

  return state.agents.filter((agent) => {
    const sessions = state.sessions[agent.id] ?? NO_SESSIONS

    // An agent belongs to a project only through its sessions — it has no
    // project of its own, so one with none is filtered out entirely.
    if (sessionsInProject(sessions, project).length === 0 && project !== ALL_PROJECTS) {
      return false
    }

    if (q === '') return true
    if (agent.name.toLowerCase().includes(q)) return true
    return sessionsInProject(sessions, project).some((s) =>
      s.title.toLowerCase().includes(q),
    )
  })
}

/* ---------------------------------------------------------------------
 * The task board.
 * ------------------------------------------------------------------ */

export const NO_COMMENTS: readonly TaskComment[] = Object.freeze([])

/** Tasks left by the board's text filter and its project filter. */
export function selectFilteredTasks(state: RosterState): Task[] {
  const q = state.taskQuery.trim().toLowerCase()
  const project = state.projectFilter

  return state.tasks.filter((task) => {
    if (project !== ALL_PROJECTS && task.projectId !== project) return false
    if (q === '') return true
    // The key is searchable too: "ROS-101" is how people refer to a task.
    return task.title.toLowerCase().includes(q) || task.id.toLowerCase().includes(q)
  })
}

/** Groups tasks into the four columns, in board order. */
export function columnsFor(tasks: readonly Task[]): Record<TaskStatus, Task[]> {
  const columns: Record<TaskStatus, Task[]> = {
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
  }
  for (const task of tasks) columns[task.status].push(task)
  return columns
}

export function selectOpenTask(state: RosterState): Task | null {
  return state.tasks.find((task) => task.id === state.openTaskId) ?? null
}

export function projectById(state: RosterState, id: string | null): Project | null {
  if (id === null) return null
  return state.projects.find((project) => project.id === id) ?? null
}

/** What a drop landed on: a column, or the column of the card under it. */
export function columnOf(overId: string | number, tasks: readonly Task[]): TaskStatus | null {
  const id = String(overId)
  if ((TASK_STATUSES as readonly string[]).includes(id)) return id as TaskStatus
  return tasks.find((task) => task.id === id)?.status ?? null
}

function withTaskStatus(tasks: readonly Task[], taskId: string, status: TaskStatus): Task[] {
  return tasks.map((task) => (task.id === taskId ? { ...task, status } : task))
}

/**
 * Moves a card between columns.
 *
 * The card moves before the write lands and goes back if it fails — a card
 * that hangs where it was dropped reads as a broken drag, and one that moves
 * and silently stays moved after a failed write is a lie. Resolves an error
 * message, or null when it worked.
 */
export async function moveTask(taskId: string, status: TaskStatus): Promise<string | null> {
  const previous = useRoster.getState().tasks.find((task) => task.id === taskId)
  if (!previous || previous.status === status) return null

  useRoster.setState((s) => ({ tasks: withTaskStatus(s.tasks, taskId, status) }))

  try {
    await window.roster.tasks.apply(taskId, { field: 'status', value: status })
    return null
  } catch (cause) {
    useRoster.setState((s) => ({ tasks: withTaskStatus(s.tasks, taskId, previous.status) }))
    return messageFor(cause)
  }
}

export function selectCurrentAgent(state: RosterState): Agent | null {
  return state.agents.find((a) => a.id === state.agentId) ?? null
}

/**
 * The status to show for an agent: its own, rolled up with its sessions'.
 * Computed here rather than stored, so a live status event moves the dot
 * without another read from disk.
 */
export function agentStatus(state: RosterState, agent: Agent): Status {
  const sessions = state.sessions[agent.id] ?? NO_SESSIONS
  return rollUpAgentStatus(
    agent.status,
    sessions.map((session) => session.status),
  )
}

/* ---------------------------------------------------------------------
 * Live turn events. Kept as a pure reducer so it can be tested without
 * React or IPC.
 * ------------------------------------------------------------------ */

export function reduceSessionEvent(
  state: RosterState,
  event: SessionEventPayload,
): Partial<RosterState> {
  switch (event.type) {
    case 'message': {
      const existing = state.messages[event.sessionId] ?? []
      return {
        messages: { ...state.messages, [event.sessionId]: [...existing, event.message] },
      }
    }

    case 'message-updated': {
      const existing = state.messages[event.sessionId] ?? []
      const index = existing.findIndex((m) => m.id === event.message.id)
      // An update for a message we never saw is appended rather than dropped.
      const next =
        index === -1
          ? [...existing, event.message]
          : existing.map((m) => (m.id === event.message.id ? event.message : m))

      return { messages: { ...state.messages, [event.sessionId]: next } }
    }

    case 'status':
      return { sessions: withSessionStatus(state.sessions, event.sessionId, event.status) }

    case 'streaming':
      return {
        streaming: { ...state.streaming, [event.sessionId]: event.active },
        // A finished turn leaves no activity to report.
        ...(event.active ? {} : { activity: withoutKey(state.activity, event.sessionId) }),
      }

    case 'activity':
      return { activity: { ...state.activity, [event.sessionId]: event.text } }

    case 'usage':
      return { usage: { ...state.usage, [event.sessionId]: event.usage } }

    case 'approval': {
      const existing = state.approvals[event.sessionId] ?? []
      return {
        approvals: { ...state.approvals, [event.sessionId]: [...existing, event.approval] },
      }
    }

    case 'approval-resolved': {
      const existing = state.approvals[event.sessionId] ?? []
      return {
        approvals: {
          ...state.approvals,
          [event.sessionId]: existing.filter((a) => a.id !== event.approvalId),
        },
      }
    }
  }
}

/**
 * Live board changes. Pure, so it can be tested without React or IPC — and
 * because these arrive from agents as well as from our own writes, the same
 * event has to be safe to apply twice.
 */
export function reduceTaskEvent(
  state: RosterState,
  event: TaskEventPayload,
): Partial<RosterState> {
  switch (event.type) {
    case 'task-created':
      // Our own create already put it in the list; don't add it twice.
      if (state.tasks.some((task) => task.id === event.task.id)) return {}
      return { tasks: [...state.tasks, event.task] }

    case 'task-updated':
      return {
        tasks: state.tasks.map((task) => (task.id === event.task.id ? event.task : task)),
      }

    case 'task-deleted':
      return {
        tasks: state.tasks.filter((task) => task.id !== event.taskId),
        // Nothing left to show, so close the modal rather than leave it
        // pointing at a task that no longer exists.
        ...(state.openTaskId === event.taskId ? { openTaskId: null } : {}),
        taskComments: withoutKey(state.taskComments, event.taskId),
      }

    case 'comment': {
      const existing = state.taskComments[event.taskId]
      // A thread that was never opened has nothing to append to — it will
      // be read in full when it is.
      if (existing === undefined) return {}
      if (existing.some((comment) => comment.id === event.comment.id)) return {}

      return {
        taskComments: {
          ...state.taskComments,
          [event.taskId]: [...existing, event.comment],
        },
      }
    }

    case 'projects':
      return { projects: event.projects }
  }
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}

/** Session status lives inside the per-agent lists, so update it in place. */
function withSessionStatus(
  sessions: Record<string, Session[]>,
  sessionId: string,
  status: Status,
): Record<string, Session[]> {
  const next: Record<string, Session[]> = {}

  for (const [agentId, list] of Object.entries(sessions)) {
    next[agentId] = list.some((s) => s.id === sessionId)
      ? list.map((s) => (s.id === sessionId ? { ...s, status } : s))
      : list
  }

  return next
}
