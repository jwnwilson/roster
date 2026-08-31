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
  SpendSummary,
  Status,
  BoardStatus,
  PlanComment,
  PlanDocument,
  Task,
  TaskComment,
  TaskSessionLink,
  TaskStatus,
  TranscriptLine,
  UpdateState,
  Usage,
} from '@shared/types'
import type { PlanEventPayload, SessionEventPayload, TaskEventPayload } from '@shared/ipc'
import { rollUpAgentStatus } from '@shared/status'
import { BOARD_STATUSES } from '@shared/types'
import { messageFor } from '@/lib/errors'

export type Screen = 'grid' | 'agent' | 'skills' | 'mcp' | 'new' | 'tasks' | 'spend'
export type PaneMode = 'chat' | 'terminal'
export type McpTab = 'installed' | 'registry'
export type TaskTab = 'comments' | 'history'
export type TaskView = 'backlog' | 'board'

/** The project filter's "no filter" value, in both the grid and the board. */
export const ALL_PROJECTS = 'all'

/** The backlog priority filter's "no filter" value. */
export const ALL_PRIORITIES = 'all'

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

export interface RosterState {
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
  /** Token and cost totals per project id (or NO_PROJECT), for Spend. */
  spendByProject: Record<string, AgentUsage>
  /** agentId -> the last few lines of its most recent session. */
  transcripts: Record<string, TranscriptLine[]>
  projects: Project[]
  tasks: Task[]
  /** taskId -> its thread, loaded when the task is opened. */
  taskComments: Record<string, TaskComment[]>
  /** planId -> the plan and its current body, loaded when it is opened. */
  plans: Record<string, PlanDocument>
  /** planId -> its thread, loaded alongside the plan. */
  planComments: Record<string, PlanComment[]>
  /** Sessions attached to a task, keyed by task id. Loaded when it is opened. */
  taskSessions: Record<string, TaskSessionLink[]>
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
  /** What the updater last reported; drives the sidebar's update row. */
  update: UpdateState
  /** The running app's version, for the sidebar footer. Empty until asked. */
  appVersion: string
  editOpen: boolean
  draft: Draft | null

  /* ---- Tasks board -------------------------------------------------- */
  /** Which of the Tasks screen's two views is showing. */
  taskView: TaskView
  /** The task whose detail modal is open. */
  openTaskId: string | null
  /** The plan being reviewed, or null. Mounted by the agent screen. */
  openPlanId: string | null
  taskQuery: string
  taskTab: TaskTab
  /* ---- Backlog ------------------------------------------------------ */
  backlogQuery: string
  /** ALL_PRIORITIES, or a TaskPriority. */
  backlogPriority: string
  /** The backlog row whose detail fills the panel beside the list. */
  backlogSelectedId: string | null
  /** Which button opened the New Task modal decides what it creates. */
  newTaskStatus: TaskStatus
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
  notionOpen: boolean

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
  setSpend(summary: SpendSummary): void
  setUpdate(update: UpdateState): void
  setAppVersion(version: string): void
  setTranscripts(transcripts: Record<string, TranscriptLine[]>): void
  setAllSessions(sessions: Record<string, Session[]>): void
  setMcpServers(servers: McpServer[]): void
  setSkills(skills: Skill[]): void
  setProjects(projects: Project[]): void
  setTasks(tasks: Task[]): void
  /** Replaces a session's pending approvals, as read back from the main process. */
  setApprovals(sessionId: string, approvals: Approval[]): void
  setTaskComments(taskId: string, comments: TaskComment[]): void
  setPlan(document: PlanDocument): void
  setPlanComments(planId: string, comments: PlanComment[]): void
  setTaskSessions(taskId: string, links: TaskSessionLink[]): void
  /** Applies one live board change from the main process. */
  applyTaskEvent(event: TaskEventPayload): void
  /** Applies one live event from the main process. */
  applySessionEvent(event: SessionEventPayload): void

  go(screen: Screen): void
  openAgent(agentId: string, sessionId?: string): void
  selectSession(agentId: string, sessionId: string): void
  setMode(mode: PaneMode): void
  setMcpTab(tab: McpTab): void

  setTaskView(view: TaskView): void
  setBacklogQuery(value: string): void
  setBacklogPriority(value: string): void
  selectBacklogTask(taskId: string): void
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
  openPlan(planId: string): void
  closePlan(): void
  applyPlanEvent(event: PlanEventPayload): void
  setProjectsOpen(open: boolean): void
  /** The status decides what the modal creates: a board task, or a backlog one. */
  setNewTaskOpen(open: boolean, status?: TaskStatus): void
  setNotionOpen(open: boolean): void

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
  spendByProject: {},
  transcripts: {},
  projects: [],
  tasks: [],
  taskComments: {},
  plans: {},
  planComments: {},
  taskSessions: {},
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
  update: { status: 'idle' },
  appVersion: '',
  editOpen: false,
  draft: null,

  taskView: 'board',
  openTaskId: null,
  openPlanId: null,
  taskQuery: '',
  taskTab: 'comments',
  backlogQuery: '',
  backlogPriority: ALL_PRIORITIES,
  backlogSelectedId: null,
  newTaskStatus: 'todo',
  projectFilter: ALL_PROJECTS,
  projectsOpen: false,
  newTaskOpen: false,
  notionOpen: false,

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
  // One payload, so the grid cards and the Spend screen can never be
  // showing totals from two different reads.
  setSpend: (summary) =>
    set({ agentUsage: summary.byAgent, spendByProject: summary.byProject }),
  setUpdate: (update) => set({ update }),
  setAppVersion: (appVersion) => set({ appVersion }),
  setTranscripts: (transcripts) => set({ transcripts }),
  setAllSessions: (sessions) => set({ sessions }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setSkills: (skills) => set({ skills }),
  setProjects: (projects) => set({ projects }),
  setTasks: (tasks) => set({ tasks }),
  setApprovals: (sessionId, approvals) =>
    set((s) => ({ approvals: { ...s.approvals, [sessionId]: approvals } })),

  setTaskComments: (taskId, comments) =>
    set((s) => ({ taskComments: { ...s.taskComments, [taskId]: comments } })),

  setPlan: (document) =>
    set((s) => ({ plans: { ...s.plans, [document.plan.id]: document } })),
  setPlanComments: (planId, comments) =>
    set((s) => ({ planComments: { ...s.planComments, [planId]: comments } })),
  setTaskSessions: (taskId, links) =>
    set((s) => ({ taskSessions: { ...s.taskSessions, [taskId]: links } })),

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

  setTaskView: (taskView) => set({ taskView }),
  setBacklogQuery: (backlogQuery) => set({ backlogQuery }),
  setBacklogPriority: (backlogPriority) => set({ backlogPriority }),
  selectBacklogTask: (backlogSelectedId) => set({ backlogSelectedId, taskTab: 'comments' }),
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

  openPlan: (openPlanId) => set({ openPlanId }),
  closePlan: () => set({ openPlanId: null }),
  applyPlanEvent: (event) => set((s) => reducePlanEvent(s, event)),
  setProjectsOpen: (projectsOpen) => set({ projectsOpen }),
  setNewTaskOpen: (newTaskOpen, newTaskStatus = 'todo') => set({ newTaskOpen, newTaskStatus }),
  setNotionOpen: (notionOpen) => set({ notionOpen }),

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

/** The default for callers with no archived projects to hide. */
const NO_ARCHIVED: ReadonlySet<string> = new Set<string>()

/** Likewise for an agent that has not said anything yet. */
export const NO_LINES: readonly TranscriptLine[] = Object.freeze([])

/**
 * The roster minus anything hidden in the Manage agents modal.
 *
 * Returns `state.agents` itself when nothing is hidden — the common case, and
 * a fresh array there would re-render every consumer forever.
 *
 * Hiding stops here: task assignees, the handoff tool and the Skills and MCP
 * screens all read `state.agents` directly, because a hidden agent is only
 * off the two roster surfaces, not off the roster.
 */
export function selectVisibleAgents(state: RosterState): Agent[] {
  if (!state.agents.some((agent) => agent.hidden)) return state.agents
  return state.agents.filter((agent) => !agent.hidden)
}

export function selectSidebarAgents(state: RosterState): Agent[] {
  const visible = selectVisibleAgents(state)
  const q = state.query.trim().toLowerCase()
  if (q === '') return visible
  return visible.filter((a) => a.name.toLowerCase().includes(q))
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
  archived: ReadonlySet<string> = NO_ARCHIVED,
): readonly Session[] {
  // Nothing to narrow: hand back the same array, or every card re-renders.
  if (projectFilter === ALL_PROJECTS && archived.size === 0) return sessions

  return sessions.filter((session) => {
    const projectId = session.projectId ?? null
    if (isHidden(projectId, archived)) return false
    return projectFilter === ALL_PROJECTS || projectId === projectFilter
  })
}

export function selectGridAgents(state: RosterState): Agent[] {
  const q = state.gridQuery.trim().toLowerCase()
  const project = state.projectFilter
  const archived = archivedProjectIds(state)

  return state.agents.filter((agent) => {
    if (agent.hidden) return false

    const sessions = state.sessions[agent.id] ?? NO_SESSIONS
    const visible = sessionsInProject(sessions, project, archived)

    // An agent belongs to a project only through its sessions — it has no
    // project of its own, so one with none is filtered out entirely. An
    // agent whose every session sits under an archived project goes the
    // same way; one that simply has no sessions yet is new, and stays.
    if (visible.length === 0 && (project !== ALL_PROJECTS || sessions.length > 0)) {
      return false
    }

    if (q === '') return true
    if (agent.name.toLowerCase().includes(q)) return true
    return visible.some((s) => s.title.toLowerCase().includes(q))
  })
}

/* ---------------------------------------------------------------------
 * The task board.
 * ------------------------------------------------------------------ */

export const NO_COMMENTS: readonly TaskComment[] = Object.freeze([])

/** The same, for a plan whose thread is empty. */
export const NO_PLAN_COMMENTS: readonly PlanComment[] = Object.freeze([])
/** A stable empty list, so a task with no sessions does not re-render forever. */
export const NO_TASK_SESSIONS: readonly TaskSessionLink[] = Object.freeze([])

/**
 * The list with one task added, unless it is already in it.
 *
 * A task we create ourselves arrives twice: once from the call that made it,
 * and once from the broadcast the main process sends every window. The
 * broadcast usually wins the race, so *both* paths have to be idempotent —
 * guarding only one of them, as this did, meant every task created from the
 * New Task modal appeared on the board twice until the next reload.
 *
 * Returns the same array when there is nothing to add, so a no-op does not
 * re-render every subscriber.
 */
export function withTask(tasks: Task[], task: Task): Task[] {
  return tasks.some((existing) => existing.id === task.id) ? tasks : [...tasks, task]
}

/**
 * Every task the app is willing to show at all — the whole board plus the
 * whole backlog, minus anything under an archived project.
 *
 * This is the denominator the "N of M match" summaries count against.
 * Counting hidden work in M would have an unfiltered board claim more tasks
 * than it is showing, with nothing on screen to explain the gap.
 */
export function selectVisibleTasks(state: RosterState): Task[] {
  const archived = archivedProjectIds(state)
  return state.tasks.filter((task) => !isHidden(task.projectId, archived))
}

/** Tasks left by the board's text filter and its project filter. */
export function selectFilteredTasks(state: RosterState): Task[] {
  const q = state.taskQuery.trim().toLowerCase()
  const project = state.projectFilter
  const archived = archivedProjectIds(state)

  return state.tasks.filter((task) => {
    // Backlog work is off the board by definition; it has its own view.
    if (task.status === 'backlog') return false
    // An archived project takes its work with it. Nothing is deleted, so
    // restoring the project puts every one of these cards back.
    if (isHidden(task.projectId, archived)) return false
    if (project !== ALL_PROJECTS && task.projectId !== project) return false
    if (q === '') return true
    // The key is searchable too: "ROS-101" is how people refer to a task.
    return task.title.toLowerCase().includes(q) || task.id.toLowerCase().includes(q)
  })
}

/**
 * Groups tasks into the four columns, in board order.
 *
 * Anything that is not a column — a backlog task that slipped past the
 * filter — is dropped rather than indexed, since indexing would throw and
 * take the whole board down with it.
 */
export function columnsFor(tasks: readonly Task[]): Record<BoardStatus, Task[]> {
  const columns: Record<BoardStatus, Task[]> = {
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
  }
  for (const task of tasks) columns[task.status as BoardStatus]?.push(task)
  return columns
}

/**
 * The backlog list: work nobody has scheduled, narrowed by the sidebar's
 * own search and priority filter and by the app-wide project filter.
 *
 * The project filter is shared with the board and the grid deliberately —
 * the Backlog tab shows that dropdown twice at once, and two controls over
 * two values would read as a bug.
 */
export function selectBacklogTasks(state: RosterState): Task[] {
  const q = state.backlogQuery.trim().toLowerCase()
  const project = state.projectFilter
  const priority = state.backlogPriority
  const archived = archivedProjectIds(state)

  return state.tasks.filter((task) => {
    if (task.status !== 'backlog') return false
    if (isHidden(task.projectId, archived)) return false
    if (project !== ALL_PROJECTS && task.projectId !== project) return false
    if (priority !== ALL_PRIORITIES && task.priority !== priority) return false
    if (q === '') return true
    return task.title.toLowerCase().includes(q) || task.id.toLowerCase().includes(q)
  })
}

export function selectOpenTask(state: RosterState): Task | null {
  return state.tasks.find((task) => task.id === state.openTaskId) ?? null
}

export function projectById(state: RosterState, id: string | null): Project | null {
  if (id === null) return null
  return state.projects.find((project) => project.id === id) ?? null
}

/* ---------------------------------------------------------------------
 * Archived projects.
 *
 * `state.projects` holds every project, archived ones included, because
 * Spend and every task card resolve a name by id and old work must keep
 * naming the project it belonged to. What changes when a project is
 * archived is only what the app still offers and still shows.
 * ------------------------------------------------------------------ */

/** The projects still on offer — everything a picker should list. */
export function activeProjects(state: RosterState): Project[] {
  return state.projects.filter((project) => project.archivedAt === null)
}

/** The ones put away, newest first: the order the archived list reads in. */
export function archivedProjects(state: RosterState): Project[] {
  return state.projects
    .filter((project) => project.archivedAt !== null)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
}

/**
 * The ids whose work is hidden.
 *
 * Built fresh on each call and never returned from a component selector —
 * a new Set as a selector's result would re-render forever under zustand v5.
 */
export function archivedProjectIds(state: RosterState): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const project of state.projects) {
    if (project.archivedAt !== null) ids.add(project.id)
  }
  return ids
}

/** Whether this task or session is hidden by the project it belongs to. */
function isHidden(projectId: string | null, archived: ReadonlySet<string>): boolean {
  return projectId !== null && archived.has(projectId)
}

/**
 * The projects a picker should offer: the active ones, plus whatever is
 * already selected even when that has been archived.
 *
 * Select is a native `<select>`, which renders blank on a value it has no
 * option for — so without the second half, a task filed under an archived
 * project would look unfiled, and saving the form would silently move it.
 *
 * Returns the store's own Project objects rather than freshly built option
 * records: `useShallow` compares one level deep, so new objects every call
 * would re-render forever. Call sites map these to options in render, where
 * a fresh array is harmless.
 */
export function projectPickerProjects(state: RosterState, current: string | null): Project[] {
  const options = activeProjects(state)

  const selected = projectById(state, current)
  if (selected === null || selected.archivedAt === null) return options

  return [...options, selected]
}

/** How a picker names a project. An archived one says so. */
export function projectOptionLabel(project: Project): string {
  return project.archivedAt === null ? project.name : `${project.name} (archived)`
}

/** What a drop landed on: a column, or the column of the card under it. */
export function columnOf(overId: string | number, tasks: readonly Task[]): BoardStatus | null {
  const id = String(overId)
  if ((BOARD_STATUSES as readonly string[]).includes(id)) return id as BoardStatus

  const status = tasks.find((task) => task.id === id)?.status
  // Only a column is a drop target. Backlog is not one, so a card can never
  // be dropped out of the board and into it.
  return status !== undefined && (BOARD_STATUSES as readonly string[]).includes(status)
    ? (status as BoardStatus)
    : null
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
export async function moveTask(taskId: string, status: BoardStatus): Promise<string | null> {
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
      return { tasks: withTask(state.tasks, event.task) }

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
        taskSessions: withoutKey(state.taskSessions, event.taskId),
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

    case 'task-session': {
      const existing = state.taskSessions[event.taskId]
      // A panel that was never opened has nothing to append to — the list
      // will be read in full when it is.
      if (existing === undefined) return {}
      if (existing.some((link) => link.sessionId === event.link.sessionId)) return {}

      return {
        taskSessions: {
          ...state.taskSessions,
          [event.taskId]: [...existing, event.link],
        },
      }
    }

    case 'projects': {
      // The filter can only offer active projects, so one pointing at a
      // project archived or deleted in another window has to let go — a
      // filter with no matching option shows an empty board and no reason.
      const stillOffered = event.projects.some(
        (project) => project.id === state.projectFilter && project.archivedAt === null,
      )

      return {
        projects: event.projects,
        ...(state.projectFilter !== ALL_PROJECTS && !stillOffered
          ? { projectFilter: ALL_PROJECTS }
          : {}),
      }
    }
  }
}

/**
 * Plan changes from the main process, applied to whatever is open.
 *
 * Pure, like reduceTaskEvent, so the ordering rules can be tested without
 * React or IPC. Nothing is invented here: a plan or thread this window has
 * never read is left alone, because it will be read in full when it is
 * opened, and a half-filled record would render as a plan with no body.
 */
export function reducePlanEvent(
  state: RosterState,
  event: PlanEventPayload,
): Partial<RosterState> {
  switch (event.type) {
    case 'plan-updated': {
      const existing = state.plans[event.plan.id]
      if (existing === undefined) return {}

      // The body is deliberately not touched: only the store has the new
      // version, and showing v1 under a v2 heading would be worse than
      // waiting for the modal to re-read it.
      return { plans: { ...state.plans, [event.plan.id]: { ...existing, plan: event.plan } } }
    }

    case 'comment': {
      const existing = state.planComments[event.planId]
      if (existing === undefined) return {}
      // It arrives from the call that wrote it and from the broadcast.
      if (existing.some((comment) => comment.id === event.comment.id)) return {}

      return {
        planComments: {
          ...state.planComments,
          [event.planId]: [...existing, event.comment],
        },
      }
    }
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
