/** What is real, and what is a fixture.
 *
 * Roughly half the designed screens still have no backend, and the boundary runs
 * *through* screens rather than between them: the Board's work items and assigned
 * agent are live while the token count on the very same card is not. A registry
 * keyed by screen would therefore lie about exactly the screens where the lie is
 * most expensive.
 *
 * So provenance is keyed by **capability** — a named unit of data — and a screen's
 * badge is the union of what it consumes. Un-mocking is deleting a file from
 * `src/mocks/unbacked/`, which the test beside this file then forces the registry
 * to reflect.
 */

export type CapabilityEntry =
  | { status: "live"; endpoint: string }
  | { status: "unbacked"; reason: string };

export const CAPABILITIES = {
  "projects.list": { status: "live", endpoint: "GET /projects" },
  "projects.create": { status: "live", endpoint: "POST /projects" },
  "projects.delete": { status: "live", endpoint: "DELETE /projects/{id}" },
  "projects.itemCount": {
    status: "unbacked",
    reason: "Project has no item_count; derived client-side from work items",
  },

  "workItems.listByProject": { status: "live", endpoint: "GET /work-items?project_id=" },
  "workItems.create": { status: "live", endpoint: "POST /work-items" },
  "workItems.update": { status: "live", endpoint: "PATCH /work-items/{id}" },
  "workItems.assignedAgent": { status: "live", endpoint: "GET /work-items?project_id=" },
  "workItems.readOne": {
    status: "unbacked",
    reason: "no GET /work-items/{id}; detail reads from the project listing",
  },
  "workItems.activity": {
    status: "unbacked",
    reason: "no work-item activity log; only threads record what happened",
  },

  "agents.list": { status: "live", endpoint: "GET /agents" },
  "agents.workingStatus": { status: "live", endpoint: "GET /agents" },
  "agents.write": { status: "unbacked", reason: "no agent write endpoints" },

  "threads.list": { status: "live", endpoint: "GET /threads" },
  "threads.messages": { status: "live", endpoint: "GET /threads/{id}/messages" },
  "threads.post": { status: "live", endpoint: "POST /threads/{id}/messages" },
  "threads.resolve": { status: "live", endpoint: "PATCH /threads/{id}" },
  "threads.stream": { status: "live", endpoint: "GET /threads/{id}/stream" },

  "memory.read": { status: "live", endpoint: "GET /projects/{id}/memory" },

  "tokens.usage": {
    status: "unbacked",
    reason: "no token, spend or progress field exists on any entity",
  },
  "mcp.servers": { status: "unbacked", reason: "no McpServer persistence" },
  "mcp.detail": { status: "unbacked", reason: "no McpServer persistence" },
  "attachments.list": { status: "unbacked", reason: "no Attachment persistence" },
  "attachments.upload": { status: "unbacked", reason: "no Attachment persistence" },
  "secrets.list": { status: "unbacked", reason: "no Secret persistence" },
} as const satisfies Record<string, CapabilityEntry>;

export type CapabilityKey = keyof typeof CAPABILITIES;

export const SCREEN_CAPABILITIES = {
  board: [
    "projects.list",
    "workItems.listByProject",
    "workItems.assignedAgent",
    "tokens.usage",
  ],
  issuesList: [
    "projects.list",
    "workItems.listByProject",
    "workItems.assignedAgent",
    "tokens.usage",
  ],
  workItemSpec: ["workItems.readOne", "workItems.update", "tokens.usage"],
  workItemActivity: ["workItems.readOne", "workItems.activity"],
  workItemThread: ["threads.messages", "threads.post", "threads.stream"],
  workItemAttachments: ["attachments.list", "attachments.upload"],
  createProject: ["projects.create"],
  createWorkItem: ["workItems.create"],
  agents: ["agents.list", "agents.workingStatus", "tokens.usage"],
  agentDetail: ["agents.list", "agents.write"],
  threads: [
    "threads.list",
    "threads.messages",
    "threads.post",
    "threads.resolve",
    "threads.stream",
  ],
  chatPanel: ["threads.list", "threads.messages", "threads.post", "threads.stream"],
  mcpServers: ["mcp.servers"],
  mcpServerDetail: ["mcp.detail"],
  dashboard: ["agents.list", "agents.workingStatus", "tokens.usage"],
  settingsSecrets: ["secrets.list"],
} as const satisfies Record<string, readonly CapabilityKey[]>;

export type ScreenKey = keyof typeof SCREEN_CAPABILITIES;

export function screenProvenance(screen: ScreenKey): {
  live: boolean;
  unbacked: CapabilityKey[];
} {
  const unbacked = SCREEN_CAPABILITIES[screen].filter(
    (key) => CAPABILITIES[key].status === "unbacked",
  );
  return { live: unbacked.length === 0, unbacked: [...unbacked] };
}
