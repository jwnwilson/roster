/** There is no `McpServer` persistence — nothing on this screen is real.
 *
 * Shaped as an eventual API would return it (snake_case, an envelope-friendly
 * list) so the screens settle against a plausible contract rather than inventing
 * their own vocabulary for whoever builds it.
 */
export type McpStatus = "connected" | "auth_expired" | "disabled";

export type McpTool = { name: string; enabled: boolean };

export type McpAgentAccess = { agent_name: string; scope: "all" | "read_only" | "none" };

export type McpCall = {
  id: string;
  at: string;
  agent_name: string;
  tool: string;
  argument: string;
  latency_ms: number;
  denied: boolean;
};

export type McpServer = {
  name: string;
  endpoint: string;
  status: McpStatus;
  transport: "stdio" | "http";
  command: string;
  auth_secret: string | null;
  attention: string | null;
  tools: McpTool[];
  access: McpAgentAccess[];
  calls_today: number;
  p50_ms: number;
  recent_calls: McpCall[];
};

export const mcpServers: McpServer[] = [
  {
    name: "github",
    endpoint: "github.com/mcp",
    status: "connected",
    transport: "http",
    command: "npx -y @modelcontextprotocol/server-github",
    auth_secret: "GITHUB_TOKEN",
    attention: null,
    tools: [
      { name: "search_code", enabled: true },
      { name: "create_issue", enabled: true },
      { name: "merge_pull_request", enabled: false },
    ],
    access: [
      { agent_name: "atlas", scope: "all" },
      { agent_name: "beacon", scope: "read_only" },
    ],
    calls_today: 128,
    p50_ms: 240,
    recent_calls: [
      {
        id: "c1", at: "09:12:04", agent_name: "atlas", tool: "search_code",
        argument: "repo:acme/api auth", latency_ms: 210, denied: false,
      },
      {
        id: "c2", at: "09:11:40", agent_name: "beacon", tool: "merge_pull_request",
        argument: "#42", latency_ms: 8, denied: true,
      },
    ],
  },
  {
    name: "linear",
    endpoint: "linear.app/mcp",
    status: "auth_expired",
    transport: "http",
    command: "npx -y @modelcontextprotocol/server-linear",
    auth_secret: "LINEAR_TOKEN",
    attention: "Its token expired 2 days ago, so every call is being refused.",
    tools: [{ name: "list_issues", enabled: true }],
    access: [{ agent_name: "atlas", scope: "read_only" }],
    calls_today: 0,
    p50_ms: 0,
    recent_calls: [],
  },
  {
    name: "filesystem",
    endpoint: "local",
    status: "disabled",
    transport: "stdio",
    command: "npx -y @modelcontextprotocol/server-filesystem ~/projects",
    auth_secret: null,
    attention: null,
    tools: [{ name: "read_file", enabled: false }],
    access: [],
    calls_today: 0,
    p50_ms: 0,
    recent_calls: [],
  },
];

export const findMcpServer = (name: string | undefined): McpServer | undefined =>
  mcpServers.find((server) => server.name === name);
