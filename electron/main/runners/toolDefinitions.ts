import { z } from 'zod'
import type { AnyZodRawShape, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { MEMORY_SERVER, PLANS_SERVER, ROSTER_SERVER, TASKS_SERVER } from '../../../shared/mcp'
import { buildRosterTools, type RosterTools } from './handoffTool'
import { buildTaskTools, type TaskTools } from './taskTools'
import { buildPlanTools, type PlanTools } from './planTools'
import { buildMemoryTools, type MemoryTools } from './memoryTools'

/**
 * Every built-in tool set an agent might hold, already bound to this session.
 *
 * `roster` is always there — handing work on is not opt-in. The rest are
 * present only when the session manager decided this agent should have them,
 * which is the one place that decision is made for either runner.
 */
export interface BuiltinToolSet {
  roster: RosterTools
  tasks?: TaskTools
  plans?: PlanTools
  memory?: MemoryTools
}

/**
 * One tool, and the server Roster registers it under for a Claude agent.
 *
 * Deliberately not `SdkMcpToolDefinition` itself: that type is generic in its
 * schema, so a list of tools with different schemas has no common type to be
 * held in. `args: never` is the contravariant way to say "whatever this
 * particular tool takes" — the bridge parses the arguments against the tool's
 * own schema before calling it, which is where that knowledge actually lives.
 */
export interface BuiltinToolDefinition {
  /** The server a Claude agent sees this tool under, e.g. "tasks". */
  server: string
  name: string
  description: string
  inputSchema: AnyZodRawShape
  handler: (args: never, extra: unknown) => Promise<CallToolResult>
}

/**
 * A tool factory that builds the plain object the SDK's own `tool` builds.
 *
 * `SdkMcpToolDefinition` is a record of name, description, schema and handler
 * and nothing else, so this is the SDK's factory without the SDK: it lets the
 * definitions be read by a caller that is not going to hand them to Claude —
 * the stdio server a Codex agent talks to — without loading the SDK runtime.
 */
export function defineTool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: SdkMcpToolDefinition<Schema>['handler'],
): SdkMcpToolDefinition<Schema> {
  return { name, description, inputSchema, handler }
}

/**
 * Every built-in tool this agent holds, flat, whichever CLI is behind it.
 *
 * This exists so the two runners cannot drift. The Claude path registers
 * these as in-process SDK servers and the Codex path serves them over a
 * stdio server, but both get them from `buildRosterTools`, `buildTaskTools`,
 * `buildPlanTools` and `buildMemoryTools` — adding a tool to any of those
 * gives it to both, and there is no second list to remember to update.
 */
export function builtinToolDefinitions(
  set: BuiltinToolSet,
  currentAgentId: string,
): BuiltinToolDefinition[] {
  const group = (
    server: string,
    tools: Omit<BuiltinToolDefinition, 'server'>[],
  ): BuiltinToolDefinition[] => tools.map((tool) => ({ ...tool, server }))

  return [
    ...group(ROSTER_SERVER, buildRosterTools(set.roster, currentAgentId, defineTool)),
    ...(set.tasks ? group(TASKS_SERVER, buildTaskTools(set.tasks, currentAgentId, defineTool)) : []),
    ...(set.plans ? group(PLANS_SERVER, buildPlanTools(set.plans, defineTool)) : []),
    ...(set.memory ? group(MEMORY_SERVER, buildMemoryTools(set.memory, defineTool)) : []),
  ]
}

/**
 * The tools that only read.
 *
 * Named rather than derived, because nothing in a tool definition says so.
 * Getting one wrong costs a hint, not correctness — see `annotationsFor`.
 */
const READ_ONLY_TOOLS = new Set(['list_agents', 'list_tasks', 'read_task', 'recall'])

/** One tool as an MCP client that is not the Agent SDK receives it. */
export interface WireTool {
  name: string
  description: string
  /** JSON Schema, since a zod shape cannot cross a process boundary. */
  inputSchema: Record<string, unknown>
  annotations: {
    readOnlyHint?: boolean
    destructiveHint: boolean
    openWorldHint: boolean
  }
}

/**
 * The definitions as a separate CLI needs them: JSON Schema, plus annotations.
 *
 * The annotations are not decoration. `codex exec` runs with nobody there to
 * answer an approval, and an MCP tool that does not say otherwise is assumed
 * destructive — so an unannotated tool is cancelled the moment the model
 * calls it, and the agent is told "the tool call was cancelled" rather than
 * anything it can act on. Saying these are not destructive is also simply
 * true: they add a task, a comment, a note or a session, and destroy nothing.
 *
 * That they are auto-approved matches the Claude path exactly, and for the
 * same reason: what decides whether an agent may touch the board is whether
 * the server was registered for it at all, not a per-call gate.
 */
export function toWireTools(definitions: BuiltinToolDefinition[]): WireTool[] {
  return definitions.map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: toJsonSchema(definition.inputSchema),
    annotations: annotationsFor(definition.name),
  }))
}

function annotationsFor(name: string): WireTool['annotations'] {
  return {
    ...(READ_ONLY_TOOLS.has(name) ? { readOnlyHint: true } : {}),
    destructiveHint: false,
    openWorldHint: false,
  }
}

/**
 * A tool's zod shape as JSON Schema.
 *
 * `$schema` is dropped: it is the same line on every tool, and every one of
 * them is sent to the model on every turn.
 */
function toJsonSchema(shape: AnyZodRawShape): Record<string, unknown> {
  // The SDK accepts either zod major version's shape; Roster's own tools are
  // written against the zod it depends on, which is the one imported here.
  const schema = z.toJSONSchema(z.object(shape as z.ZodRawShape)) as Record<string, unknown>
  delete schema['$schema']
  return schema
}
