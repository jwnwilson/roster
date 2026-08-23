import { create } from 'zustand'
import type {
  Agent,
  Approval,
  McpServer,
  Message,
  RunnerStatus,
  Session,
  Skill,
  Status,
  TranscriptLine,
  Usage,
} from '@shared/types'
import type { SessionEventPayload } from '@shared/ipc'
import { rollUpAgentStatus } from '@shared/status'

export type Screen = 'grid' | 'agent' | 'skills' | 'mcp' | 'new'
export type PaneMode = 'chat' | 'terminal'
export type McpTab = 'installed' | 'registry'

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
  /** agentId -> the last few lines of its most recent session. */
  transcripts: Record<string, TranscriptLine[]>
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
  query: string
  gridQuery: string
  editOpen: boolean
  draft: Draft | null

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
  setTranscripts(transcripts: Record<string, TranscriptLine[]>): void
  setAllSessions(sessions: Record<string, Session[]>): void
  setMcpServers(servers: McpServer[]): void
  setSkills(skills: Skill[]): void
  /** Applies one live event from the main process. */
  applySessionEvent(event: SessionEventPayload): void

  go(screen: Screen): void
  openAgent(agentId: string, sessionId?: string): void
  selectSession(agentId: string, sessionId: string): void
  setMode(mode: PaneMode): void
  setMcpTab(tab: McpTab): void

  toggleTool(id: string): void
  setQuery(value: string): void
  setGridQuery(value: string): void

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
  transcripts: {},
  loaded: false,

  screen: 'grid',
  agentId: null,
  sess: {},
  mode: 'chat',
  mcpTab: 'installed',

  openTools: {},
  query: '',
  gridQuery: '',
  editOpen: false,
  draft: null,

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
  setTranscripts: (transcripts) => set({ transcripts }),
  setAllSessions: (sessions) => set({ sessions }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setSkills: (skills) => set({ skills }),

  applySessionEvent: (event) => set((s) => reduceSessionEvent(s, event)),

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
  setQuery: (query) => set({ query }),
  setGridQuery: (gridQuery) => set({ gridQuery }),

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

export function selectGridAgents(state: RosterState): Agent[] {
  const q = state.gridQuery.trim().toLowerCase()
  if (q === '') return state.agents

  return state.agents.filter((agent) => {
    if (agent.name.toLowerCase().includes(q)) return true
    const sessions = state.sessions[agent.id] ?? []
    return sessions.some((s) => s.title.toLowerCase().includes(q))
  })
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
