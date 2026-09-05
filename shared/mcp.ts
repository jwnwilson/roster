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

/** Reporting the pull request a built plan ended in. */
export const PLANS_SERVER = 'plans'

/**
 * The project's notes: recall them, and append to them.
 *
 * Gated per agent like the board, and for a sharper reason: a project's
 * notes go to the model on every turn, and they are as sensitive as its
 * tasks. Enabling this is what opts an agent into the project's memory.
 */
export const MEMORY_SERVER = 'memory'

export const BUILTIN_MCP_SERVERS: readonly BuiltinMcpServer[] = [
  {
    name: TASKS_SERVER,
    // Sits where a launch command sits on the other cards, so it has to read
    // at a glance rather than explain the whole feature.
    description: 'Assign, move, comment on and file tasks on the shared board.',
  },
  {
    name: PLANS_SERVER,
    description: 'Report the pull request a plan was built into, so Roster can link to it.',
  },
  {
    name: MEMORY_SERVER,
    description: "Recall and add to the project's notes, so each session starts where the last left off.",
  },
]

export function isBuiltinMcpServer(name: string): boolean {
  return BUILTIN_MCP_SERVERS.some((server) => server.name === name)
}

/* -------------------------------------------------------------------------
 * Notion.
 *
 * Not a built-in — it is an ordinary stdio server from the registry. It is
 * named here because Roster itself also talks to Notion, and reads the token
 * out of this server's environment rather than keeping a second copy of it.
 * ---------------------------------------------------------------------- */

export const NOTION_SERVER = 'notion'

/**
 * Published by Notion, not under the reference servers' name — so the
 * registry's `@modelcontextprotocol/server-<name>` guess does not work here
 * and the entry carries this instead.
 */
export const NOTION_MCP_COMMAND = 'npx -y @notionhq/notion-mcp-server'

/** Where that server reads its integration token from, and where Roster looks. */
export const NOTION_TOKEN_ENV = 'NOTION_TOKEN'
