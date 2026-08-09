/** Fixtures shaped exactly like the API's responses.
 *
 * Shared by the live-parity handlers (which mirror real endpoints so the app runs
 * with no backend) and by tests. Anything here that has no endpoint behind it
 * lives in `unbacked/` and is registered in the capability registry. */
import type { Agent, Message, Project, ThreadListItem, WorkItem } from "../lib/api/types";

export const project: Project = {
  id: "p1",
  name: "api-service",
  source: { kind: "git", url: "https://github.com/acme/api-service", path: null },
  folder_path: "/Users/dev/repos/api-service",
  created_at: "2026-08-01T09:00:00Z",
  updated_at: "2026-08-01T09:00:00Z",
};

export const infraProject: Project = {
  ...project,
  id: "p2",
  name: "infra",
  source: { kind: "local", url: null, path: "/Users/dev/infra" },
};

export const workItem: WorkItem = {
  id: "w1",
  key: "ROS-1",
  project_id: "p1",
  type: "task",
  title: "Read the project memory and summarise the codebase",
  status: "in_progress",
  priority: "high",
  epic_id: null,
  feature_id: null,
  spec: "# Summarise the codebase\n\nRead `.roster/memory/MEMORY.md` first.",
  agent_name: "atlas",
  sequence: 1,
  created_at: "2026-08-01T09:00:00Z",
  updated_at: "2026-08-02T09:00:00Z",
};

export const agent: Agent = {
  name: "atlas",
  model: "claude-opus-5",
  token_limit: 200000,
  temperature: 0.2,
  instructions: "# atlas\n\nYou are roster's demo agent.",
  skills: ["research"],
  status: "working",
  problem: null,
};

export const brokenAgent: Agent = {
  ...agent,
  name: "cinder",
  status: "disabled",
  problem: "AGENT.md is missing",
};

export const thread: ThreadListItem = {
  id: "t1",
  project_id: "p1",
  work_item_id: "w1",
  title: "Read the project memory and summarise the codebase",
  status: "action_needed",
  read: false,
  created_at: "2026-08-02T09:00:00Z",
  updated_at: "2026-08-02T09:10:00Z",
  resolved_at: null,
  message_count: 3,
  last_message: "Should the summary cover the tests as well as the source?",
  participants: ["atlas"],
};

export const leadThread: ThreadListItem = {
  ...thread,
  id: "t2",
  work_item_id: null,
  title: "Plan the quarter",
  status: "info",
  message_count: 2,
  last_message: "The memory summary looks like the cheapest place to start.",
};

export const messages: Message[] = [
  {
    id: "m1", thread_id: "t1", author_kind: "user", author_name: null,
    kind: "text", content: "Go ahead and start on this.", payload: null,
    created_at: "2026-08-02T09:00:00Z",
  },
  {
    id: "m2", thread_id: "t1", author_kind: "agent", author_name: "atlas",
    kind: "file_write", content: ".roster/artifacts/summary.md", payload: null,
    created_at: "2026-08-02T09:05:00Z",
  },
  {
    id: "m3", thread_id: "t1", author_kind: "agent", author_name: "atlas",
    kind: "question", content: "Should the summary cover the tests as well as the source?",
    payload: null, created_at: "2026-08-02T09:10:00Z",
  },
];

/** The lead-agent conversation's messages — deliberately different text from
 *  `messages`, so a screen showing the wrong thread fails a test instead of
 *  rendering something plausible. */
export const leadMessages: Message[] = [
  {
    id: "lm1", thread_id: "t2", author_kind: "user", author_name: null,
    kind: "text", content: "What should we pick up first?", payload: null,
    created_at: "2026-08-02T08:00:00Z",
  },
  {
    id: "lm2", thread_id: "t2", author_kind: "agent", author_name: "atlas",
    kind: "text", content: "The memory summary is the cheapest place to start.",
    payload: null, created_at: "2026-08-02T08:05:00Z",
  },
];
