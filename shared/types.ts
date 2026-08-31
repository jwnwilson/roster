/**
 * Domain types shared between the main process and the renderer.
 * The preload bridge speaks exactly these shapes.
 */

/* -------------------------------------------------------------------------
 * Status vocabulary — used on agents, sessions, and grid cards alike.
 * `error` is defined in the design handoff but unused by its demo data; we
 * reach it when an agent's runner is missing or not authenticated.
 * ---------------------------------------------------------------------- */
export const STATUSES = ['running', 'approval', 'done', 'idle', 'error'] as const
export type Status = (typeof STATUSES)[number]

/* -------------------------------------------------------------------------
 * Runners — an agent is backed by a CLI running on the user's own account.
 * ---------------------------------------------------------------------- */
export const BUILTIN_RUNNERS = ['claude', 'codex', 'gemini'] as const
export type BuiltinRunnerId = (typeof BUILTIN_RUNNERS)[number]
export type RunnerId = BuiltinRunnerId | (string & {})

/** Which provider label a runner presents in the picker. */
export type ProviderName = 'Anthropic' | 'OpenAI' | 'Google' | string

export type AuthKind = 'subscription' | 'api-key' | 'none'

export interface RunnerStatus {
  id: RunnerId
  provider: ProviderName
  /** Binary resolved on PATH. */
  installed: boolean
  /** Usable right now: installed and authenticated. */
  ready: boolean
  auth: AuthKind
  /** Absolute path to the binary, resolved once so spawning cannot miss it. */
  path?: string
  /** Version string when detectable. */
  version?: string
  /** Human-readable reason when not ready, surfaced in the config rail. */
  detail?: string
}

export interface ModelInfo {
  id: string
  /** Rendered right-aligned in the model list, e.g. "$3 / $15". */
  price: string
}

/* -------------------------------------------------------------------------
 * Agents — configuration lives in <cwd>/agent.toml.
 * ---------------------------------------------------------------------- */
export interface Agent {
  id: string
  name: string
  runner: RunnerId
  model: string
  cwd: string
  /** cwd with the home directory collapsed to ~, for display. */
  cwdLabel: string
  systemPrompt: string
  skills: string[]
  mcpServers: string[]
  /**
   * Kept off the sidebar roster and the agent grid. Hiding is a view control
   * only: a hidden agent is still assignable, still a handoff target, and
   * still spends.
   */
  hidden: boolean
  /** Only present when runner is not a builtin. */
  custom?: CustomRunnerSpec
  /** Derived, not persisted. */
  status: Status
  /** Populated when status is 'error'. */
  statusDetail?: string
}

export interface CustomRunnerSpec {
  command: string
  args: string[]
}

/* -------------------------------------------------------------------------
 * Sessions and messages — persisted in SQLite.
 * ---------------------------------------------------------------------- */
export type SessionOrigin = 'you' | 'agent'

export interface Session {
  id: string
  agentId: string
  title: string
  origin: SessionOrigin
  /** Display name of the agent that opened this session, when origin is 'agent'. */
  from?: string
  /** Agent + session this one was spawned from, for the "back to X" pill. */
  spawnedFrom?: SessionRef
  status: Status
  /** The runner's own session id, used for resume and fork. */
  runnerSessionId?: string
  /**
   * The project this session's work belongs to, assigned by hand from the
   * config rail. Null until someone says — nothing infers it.
   */
  projectId?: string | null
  createdAt: number
}

export interface SessionRef {
  agentId: string
  sessionId: string
  label: string
}

export type MessageKind = 'text' | 'tool' | 'spawn' | 'handoff'

export interface BaseMessage {
  id: string
  sessionId: string
  kind: MessageKind
  createdAt: number
}

export interface TextMessage extends BaseMessage {
  kind: 'text'
  role: 'user' | 'assistant'
  /** Display label: "you" or the agent's name. */
  who: string
  text: string
}

export interface ToolMessage extends BaseMessage {
  kind: 'tool'
  tool: string
  /** One line, for the collapsed row. See summariseArgs. */
  args: string
  /**
   * Everything the tool was called with, as JSON, when that is more than the
   * summary. A question's options live only here. Absent for a tool whose
   * arguments the summary already shows in full.
   */
  input?: string
  output: string
  isError: boolean
  /** Milliseconds; formatted as "1.2s" at render time. */
  durationMs?: number
}

export interface SpawnMessage extends BaseMessage {
  kind: 'spawn'
  /** Display name of the agent that opened this session. */
  from: string
  text: string
  to?: SessionRef
}

export interface HandoffMessage extends BaseMessage {
  kind: 'handoff'
  links: HandoffLink[]
}

export interface HandoffLink extends SessionRef {
  status: Status
}

export type Message = TextMessage | ToolMessage | SpawnMessage | HandoffMessage

/* -------------------------------------------------------------------------
 * Approvals — raised by the runner, resolved by the user.
 * ---------------------------------------------------------------------- */
export interface Approval {
  id: string
  sessionId: string
  toolName: string
  /** The exact command, shown in monospace in the banner. */
  command: string
  /**
   * Present when the agent is asking rather than acting.
   *
   * A question reaches Roster as a permission request: the tool carries an
   * `answers` field the permission step is expected to fill in, so answering
   * and allowing are the same act. Approvals with questions are answered in
   * the transcript rather than allowed or denied in the banner.
   */
  questions?: Question[]
  status: 'pending' | 'approved' | 'denied'
  createdAt: number
  decidedAt?: number
}

export interface QuestionOption {
  /** Shown on the button; one to five words. */
  label: string
  /** What choosing it means. */
  description: string
}

export interface Question {
  question: string
  /** A short chip above the question, twelve characters or fewer. */
  header: string
  /** Several options may be chosen, rather than exactly one. */
  multiSelect: boolean
  options: QuestionOption[]
}

/* -------------------------------------------------------------------------
 * Usage — drives the token/spend readouts and the context-window bar.
 * ---------------------------------------------------------------------- */
export interface Usage {
  sessionId: string
  inputTokens: number
  outputTokens: number
  /** Every token consumed, cache included; see the runner event of the same name. */
  totalTokens: number
  costUsd: number
}

/** What one agent has spent, summed across its sessions. */
export interface AgentUsage {
  tokens: number
  costUsd: number
}

/**
 * The bucket sessions land in when nobody has assigned them a project.
 *
 * A real key rather than null, so the rollup is one flat map and the Spend
 * screen can label it without a second code path.
 */
export const NO_PROJECT = 'none'

/** Every rollup the Spend screen needs, in one round trip. */
export interface SpendSummary {
  byAgent: Record<string, AgentUsage>
  /** Keyed by project id, or NO_PROJECT. */
  byProject: Record<string, AgentUsage>
}

/* -------------------------------------------------------------------------
 * Projects and tasks — the shared board, persisted in SQLite.
 * ---------------------------------------------------------------------- */

/** The four kanban columns, in board order. */
export const BOARD_STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const
export type BoardStatus = (typeof BOARD_STATUSES)[number]

/**
 * Every status a task can hold.
 *
 * Backlog comes first and is deliberately not a column: it is where an idea
 * lives before anyone is ready to schedule it. Anything that renders the
 * board wants BOARD_STATUSES; anything that lets someone choose a status
 * wants this.
 */
export const TASK_STATUSES = ['backlog', ...BOARD_STATUSES] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Most urgent first, which is also the order the priority select shows. */
export const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

/**
 * A named grouping of work. Deliberately just metadata: a project does not
 * own a directory or a set of agents, it only labels tasks and sessions.
 */
export interface Project {
  id: string
  name: string
  /** One of PROJECT_COLORS; drawn as the dot beside the name. */
  color: string
  description: string
  createdAt: number
  /**
   * When it was archived, or null while it is active.
   *
   * Archiving takes a project out of every picker and takes its work off the
   * board, but keeps the row and everything pointing at it — so restoring it
   * brings the whole grouping back.
   */
  archivedAt: number | null
}

export interface Task {
  /** Human-readable key, e.g. "ROS-101" — this is the primary key. */
  id: string
  title: string
  /** Markdown. Written by people and by agents. */
  description: string
  status: TaskStatus
  priority: TaskPriority
  /** An agent id, or null when nobody has picked it up. */
  assigneeId: string | null
  projectId: string | null
  labels: string[]
  createdAt: number
  updatedAt: number
}

/**
 * One entry in a task's thread. `isSystem` splits the two tabs: History is
 * generated by the store when something changes, Comments is what people and
 * agents actually wrote. Keeping them in one table means one ordering.
 */
export interface TaskComment {
  id: string
  taskId: string
  author: string
  tone: 'you' | 'agent'
  text: string
  isSystem: boolean
  createdAt: number
}

/* -------------------------------------------------------------------------
 * Skills and MCP servers.
 * ---------------------------------------------------------------------- */
export interface Skill {
  name: string
  /** Absolute path to the skill folder, inside the library. */
  path: string
  /**
   * Where the folder really is, when the skill was added from elsewhere.
   * Roster links rather than copies, so editing through Roster edits the
   * user's own file and removing the skill only removes the link.
   */
  linkedFrom?: string
  files: string[]
  lastEditedMs: number
}

/**
 * A configured server. Which agents use it is not stored here — that lives in
 * each agent's `mcp_servers`, so there is exactly one place it can be wrong.
 */
export interface McpServer {
  name: string
  command: string
  /**
   * Passed to the server process on launch. Most real servers need at least
   * one — a token, a connection string — and without these Roster could
   * start them but never authenticate them.
   */
  env: Record<string, string>
  /**
   * Roster runs this one itself, in-process. There is no command to launch
   * and no environment to set, so the only thing to decide is which agents
   * may use it. See shared/mcp.ts.
   */
  builtin?: boolean
  /** What the server is for. Only built-ins carry one; the rest show their command. */
  description?: string
}

export interface RegistryEntry {
  name: string
  description: string
  author: string
  category: string
  /**
   * The launch command, when it is not `@modelcontextprotocol/server-<name>`.
   *
   * That pattern held for the reference servers and holds for nothing else —
   * Notion's is published by Notion, under its own name. An entry without
   * this one falls back to the pattern.
   */
  command?: string
}

/* -------------------------------------------------------------------------
 * Grid card previews — the last few lines of an agent's most recent session.
 * ---------------------------------------------------------------------- */
export interface TranscriptLine {
  /** Display label: "you", the agent's name, or "tool". */
  who: string
  /** Which colour the label takes, per the handoff's role colouring. */
  role: 'user' | 'agent' | 'tool'
  text: string
}

/* -------------------------------------------------------------------------
 * Updates — Roster is distributed as an unsigned DMG, so it cannot replace
 * itself the way a signed app can. It checks GitHub Releases, fetches the
 * build for this machine's architecture, and opens it for you to drag across.
 * ---------------------------------------------------------------------- */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  /** Nothing newer published, or the check could not reach GitHub. */
  | { status: 'current' }
  | { status: 'available'; version: string; notes: string; url: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string; path: string }
  | { status: 'error'; message: string }
