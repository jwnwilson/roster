/**
 * Servers Roster runs itself, in-process, rather than launching.
 *
 * They appear in the MCP list beside the ones from mcp.json and are enabled
 * per agent the same way — by name, in that agent's `mcp_servers`. That is
 * the whole point of listing them: which agents may touch the board is a
 * decision, and the MCP screen is already where per-agent tool access is
 * made. Nothing about them is configurable, so there is no launch command
 * and no environment.
 */
export interface BuiltinMcpServer {
  name: string
  description: string
}

/** The board tools: list, read, update, comment, create. */
export const TASKS_SERVER = 'tasks'

export const BUILTIN_MCP_SERVERS: readonly BuiltinMcpServer[] = [
  {
    name: TASKS_SERVER,
    // Sits where a launch command sits on the other cards, so it has to read
    // at a glance rather than explain the whole feature.
    description: 'Assign, move, comment on and file tasks on the shared board.',
  },
]

export function isBuiltinMcpServer(name: string): boolean {
  return BUILTIN_MCP_SERVERS.some((server) => server.name === name)
}
