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
  args: string
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
  status: 'pending' | 'approved' | 'denied'
  createdAt: number
  decidedAt?: number
}

/* -------------------------------------------------------------------------
 * Usage — drives the token/spend readouts and the context-window bar.
 * ---------------------------------------------------------------------- */
export interface Usage {
  sessionId: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** Fraction of the model's context window consumed, 0..1. */
  contextUsed: number
}

/* -------------------------------------------------------------------------
 * Skills and MCP servers.
 * ---------------------------------------------------------------------- */
export interface Skill {
  name: string
  /** Absolute path to the skill folder. */
  path: string
  files: string[]
  lastEditedMs: number
}

export interface McpServer {
  name: string
  command: string
  /** Agent ids this server is enabled for. */
  enabledFor: string[]
}

export interface RegistryEntry {
  name: string
  description: string
  author: string
  category: string
}
