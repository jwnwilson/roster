import { z } from 'zod'
import { MEMORY_SERVER } from '../../../shared/mcp'

/**
 * The project's notes, as an agent sees them.
 *
 * Deliberately not the store itself: the store is keyed by project id, and
 * which project an agent may reach is decided once, by the session it is
 * running in — not by an argument it could pass.
 */
export interface MemoryTools {
  /** The notes for this session's project, verbatim. Empty when there are none. */
  recall(): string
  /** Appends one dated, attributed line. Never rewrites. */
  remember(note: string): Promise<unknown>
}

/**
 * Every tool this server registers, as the SDK namespaces them.
 *
 * Exported so the runner's allowlist cannot drift from what is actually
 * registered: a tool missing from here does not fail loudly, it silently
 * blocks on the approval gate forever.
 *
 * Auto-approving these is safe for the same reason the task tools are: the
 * server is only registered for an agent that enables "memory" in its
 * `mcp_servers`, and an unregistered tool cannot be called.
 */
export const MEMORY_TOOL_NAMES = ['mcp__memory__recall', 'mcp__memory__remember'] as const

/**
 * Builds the in-process MCP server for a project's notes.
 *
 * Created lazily with the SDK's own factory so the module graph does not
 * pull in the SDK runtime for callers that only normalise events.
 */
export async function createMemoryMcpServer(memory: MemoryTools): Promise<unknown> {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')

  return createSdkMcpServer({
    name: MEMORY_SERVER,
    version: '1.0.0',
    tools: buildMemoryTools(memory, tool),
  })
}

type ToolFactory = typeof import('@anthropic-ai/claude-agent-sdk').tool

/**
 * The tool definitions themselves, given a factory to build them with.
 *
 * Exported so the handlers can be exercised without standing up the SDK:
 * pass a factory that simply records what it is handed.
 */
export function buildMemoryTools(memory: MemoryTools, tool: ToolFactory) {
  const text = (body: string, isError = false) => ({
    content: [{ type: 'text' as const, text: body }],
    ...(isError ? { isError: true } : {}),
  })

  const recall = tool(
    'recall',
    "Read this project's notes: the decisions, conventions and gotchas earlier " +
      'sessions wrote down. The most recent are already in your context; read this ' +
      'when you need the whole file.',
    {},
    async () => {
      const notes = memory.recall().trim()
      if (notes === '') return text('This project has no notes yet.')
      return text(notes)
    },
  )

  const remember = tool(
    'remember',
    'Write one thing down for whoever works on this project next — a decision, a ' +
      'convention, or something you tried that did not work. Not for anything that ' +
      'belongs on a task; comment on the task instead.',
    {
      note: z
        .string()
        .describe('One sentence, in your own words. It is dated and attributed for you.'),
    },
    async (args: { note: string }) => {
      if (args.note.trim() === '') return text('A note cannot be empty.', true)

      try {
        await memory.remember(args.note)
      } catch (cause) {
        // Saying "noted" over a write that failed would lose the finding and
        // convince the agent it was safe.
        return text(
          `Could not write the note: ${cause instanceof Error ? cause.message : String(cause)}`,
          true,
        )
      }

      return text('Noted.')
    },
  )

  return [recall, remember]
}
