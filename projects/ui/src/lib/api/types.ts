/** Types mirroring the API exactly — `snake_case`, no camel-casing layer.
 *
 * Hand-written rather than generated: roster's FastAPI serves its own OpenAPI, but
 * a generated client was what welded the source project's UI to an API it no
 * longer had. These are small enough to own.
 */

export type SourceKind = "git" | "local" | "none";

export type Project = {
  id: string;
  name: string;
  source: { kind: SourceKind; url: string | null; path: string | null };
  folder_path: string;
  created_at: string | null;
  updated_at: string | null;
};

export type WorkItemType = "epic" | "feature" | "task";
export type WorkItemStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";

export type WorkItem = {
  id: string;
  key: string;
  project_id: string;
  type: WorkItemType;
  title: string;
  status: WorkItemStatus;
  priority: Priority;
  epic_id: string | null;
  feature_id: string | null;
  spec: string | null;
  agent_name: string | null;
  sequence: number;
  created_at: string | null;
  updated_at: string | null;
};

/** Only three states, and only ever these (spec §4). `working` is transient
 *  runtime state — an agent taking a turn — and is never persisted. */
export type AgentStatus = "working" | "active" | "disabled";

/** Which CLI roster spawns for this agent. A closed enum on the backend too: an
 *  agent folder is operator content, so it names a *tool*, never a command. */
export type AgentTool = "claude" | "codex" | "gemini";

export type Agent = {
  name: string;
  tool: AgentTool;
  /** null when config.yaml names no model and the tool picks its own. Not a
   *  default to paper over: showing roster's fallback here announced a Claude
   *  model for an agent that runs codex. */
  model: string | null;
  token_limit: number;
  temperature: number | null;
  instructions: string;
  skills: string[];
  status: AgentStatus;
  /** Populated only when disabled — shown instead of an empty row. */
  problem: string | null;
};

export type ThreadStatus = "info" | "review_needed" | "action_needed" | "resolved";
export type MessageKind = "text" | "file_write" | "question" | "event";

export type Thread = {
  id: string;
  project_id: string;
  /** Null for the lead-agent conversation the chat panel shows (spec §4). */
  work_item_id: string | null;
  title: string;
  status: ThreadStatus;
  read: boolean;
  created_at: string | null;
  updated_at: string | null;
  resolved_at: string | null;
};

/** Derived server-side from the thread's messages and returned by the listing —
 *  never stored, so never sent back on a write. */
export type ThreadSummary = {
  message_count: number;
  last_message: string | null;
  participants: string[];
};

export type ThreadListItem = Thread & ThreadSummary;

export type Message = {
  id: string;
  thread_id: string;
  author_kind: "user" | "agent";
  author_name: string | null;
  kind: MessageKind;
  content: string;
  payload: Record<string, unknown> | null;
  created_at: string | null;
};
