import { z } from 'zod'
import type { Agent, Task, TaskComment, TaskPriority, TaskStatus } from '../../../shared/types'
import { TASK_PRIORITIES, TASK_STATUSES } from '../../../shared/types'
import { taskPriorityLabel, taskStatusLabel } from '../../../shared/tasks'

/**
 * The roster tools an agent can call.
 *
 * This is what makes handoff real rather than decorative: an agent asks
 * Roster to open a session on another agent, and Roster records the spawn so
 * both sides show the link.
 */
export interface RosterTools {
  listAgents(): Agent[]
  /** Returns the label to show on the handoff pill. */
  openSession(input: { toAgentId: string; title: string; brief: string }): {
    sessionId: string
    label: string
  }
}

/**
 * The task board, as an agent sees it.
 *
 * Separate from RosterTools and passed separately, so an agent without a
 * board — or a caller that only wants handoff — is unaffected.
 */
export interface TaskTools {
  list(): Task[]
  find(taskId: string): Task | null
  comments(taskId: string): TaskComment[]
  /** Resolves a project id to its name, for display. */
  projectName(projectId: string): string | null
  /** Resolves an agent id to its display name. */
  agentName(agentId: string): string | null
  create(input: {
    title: string
    description: string
    priority: TaskPriority
    projectId: string | null
  }): Task
  update(
    taskId: string,
    patch: {
      status?: TaskStatus
      priority?: TaskPriority
      assignee?: string | null
      addLabel?: string
      removeLabel?: string
    },
  ): Task
  comment(taskId: string, text: string): void
}

/**
 * Every tool this server registers, as the SDK namespaces them.
 *
 * Exported so the runner's allowlist cannot drift from what is actually
 * registered — these are affordances of the app rather than actions on the
 * user's machine, so they are auto-approved, and a tool missing from here
 * silently blocks on the approval gate instead.
 */
export const ROSTER_TOOL_NAMES = [
  'mcp__roster__list_agents',
  'mcp__roster__open_session',
  'mcp__roster__list_tasks',
  'mcp__roster__read_task',
  'mcp__roster__update_task',
  'mcp__roster__comment_on_task',
  'mcp__roster__create_task',
] as const

export const OPEN_SESSION_SCHEMA = {
  agent_id: z.string().describe('The id of the agent to hand work to.'),
  title: z.string().describe('A short title for the session, shown on its tab.'),
  brief: z.string().describe('What that agent should do. It sees this as its first message.'),
}

/**
 * Builds an in-process MCP server exposing the roster tools.
 *
 * Created lazily with the SDK's own factory so the module graph does not pull
 * in the SDK runtime for callers that only normalise events.
 */
export async function createRosterMcpServer(
  tools: RosterTools,
  currentAgentId: string,
  tasks?: TaskTools,
): Promise<unknown> {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')

  const listAgents = tool(
    'list_agents',
    'List the other agents on this roster, so you can choose one to hand work to.',
    {},
    async () => {
      const others = tools
        .listAgents()
        .filter((agent) => agent.id !== currentAgentId && agent.status !== 'error')
        .map((agent) => `${agent.id} — ${agent.name}: ${firstLine(agent.systemPrompt)}`)

      return {
        content: [
          {
            type: 'text' as const,
            text: others.length === 0 ? 'No other agents are available.' : others.join('\n'),
          },
        ],
      }
    },
  )

  const openSession = tool(
    'open_session',
    'Hand work to another agent by opening a session on it. Use list_agents first.',
    OPEN_SESSION_SCHEMA,
    async (args: { agent_id: string; title: string; brief: string }) => {
      const known = tools.listAgents().some((agent) => agent.id === args.agent_id)
      if (!known) {
        return {
          content: [{ type: 'text' as const, text: `No agent with id "${args.agent_id}".` }],
          isError: true,
        }
      }

      const { label } = tools.openSession({
        toAgentId: args.agent_id,
        title: args.title,
        brief: args.brief,
      })

      return {
        content: [{ type: 'text' as const, text: `Opened "${label}". It will pick the work up.` }],
      }
    },
  )

  return createSdkMcpServer({
    name: 'roster',
    version: '1.0.0',
    tools: [listAgents, openSession, ...(tasks ? taskToolsFor(tasks, currentAgentId, tool) : [])],
  })
}

/* -------------------------------------------------------------------------
 * The task board tools.
 *
 * Every change goes through TaskTools.update, which is TaskStore.apply — so
 * an agent moving a card writes the same History line a person dragging it
 * would, and the board updates live either way.
 * ---------------------------------------------------------------------- */

type ToolFactory = typeof import('@anthropic-ai/claude-agent-sdk').tool

// The return type is inferred deliberately: each tool's type carries its own
// zod schema, and annotating the array collapses them to a common shape the
// SDK's invariant generic then rejects.
function taskToolsFor(tasks: TaskTools, currentAgentId: string, tool: ToolFactory) {
  const text = (body: string, isError = false) => ({
    content: [{ type: 'text' as const, text: body }],
    ...(isError ? { isError: true } : {}),
  })

  const missing = (taskId: string) => text(`No task with id "${taskId}".`, true)

  const listTasks = tool(
    'list_tasks',
    'List tasks on the shared board. Use this to find work to pick up, or to check what you are already assigned.',
    {
      status: z
        .enum(TASK_STATUSES)
        .optional()
        .describe('Only tasks in this column.'),
      assigned_to_me: z
        .boolean()
        .optional()
        .describe('Only tasks already assigned to you.'),
    },
    async (args: { status?: TaskStatus; assigned_to_me?: boolean }) => {
      const matching = tasks
        .list()
        .filter((task) => args.status === undefined || task.status === args.status)
        .filter((task) => args.assigned_to_me !== true || task.assigneeId === currentAgentId)

      if (matching.length === 0) return text('No tasks match.')
      return text(matching.map((task) => summarise(task, tasks)).join('\n'))
    },
  )

  const readTask = tool(
    'read_task',
    'Read one task in full, including its description and its comment thread.',
    { task_id: z.string().describe('The task key, e.g. ROS-101.') },
    async (args: { task_id: string }) => {
      const task = tasks.find(args.task_id)
      if (!task) return missing(args.task_id)
      return text(describe(task, tasks))
    },
  )

  const updateTask = tool(
    'update_task',
    'Change a task on the board. Assign it to yourself before you start work, and move it along as you go.',
    {
      task_id: z.string().describe('The task key, e.g. ROS-101.'),
      status: z.enum(TASK_STATUSES).optional().describe('Move it to this column.'),
      priority: z.enum(TASK_PRIORITIES).optional(),
      assignee: z
        .string()
        .nullable()
        .optional()
        .describe('An agent id, or null to unassign. Use your own id to pick the task up.'),
      add_label: z.string().optional(),
      remove_label: z.string().optional(),
    },
    async (args: {
      task_id: string
      status?: TaskStatus
      priority?: TaskPriority
      assignee?: string | null
      add_label?: string
      remove_label?: string
    }) => {
      if (!tasks.find(args.task_id)) return missing(args.task_id)

      const updated = tasks.update(args.task_id, {
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.priority !== undefined ? { priority: args.priority } : {}),
        ...(args.assignee !== undefined ? { assignee: args.assignee } : {}),
        ...(args.add_label !== undefined ? { addLabel: args.add_label } : {}),
        ...(args.remove_label !== undefined ? { removeLabel: args.remove_label } : {}),
      })

      return text(`Updated. ${summarise(updated, tasks)}`)
    },
  )

  const commentOnTask = tool(
    'comment_on_task',
    'Leave a comment on a task, so whoever picks it up next knows what you found.',
    {
      task_id: z.string().describe('The task key, e.g. ROS-101.'),
      text: z.string().describe('What you want to say. Markdown is rendered.'),
    },
    async (args: { task_id: string; text: string }) => {
      if (!tasks.find(args.task_id)) return missing(args.task_id)

      tasks.comment(args.task_id, args.text)
      return text('Comment posted.')
    },
  )

  const createTask = tool(
    'create_task',
    'Put a new task on the board — work you found that is worth tracking but is not what you were asked to do now.',
    {
      title: z.string().describe('One line, in the imperative.'),
      description: z.string().optional().describe('Markdown. What needs doing, and why.'),
      priority: z.enum(TASK_PRIORITIES).optional(),
      project_id: z.string().nullable().optional(),
    },
    async (args: {
      title: string
      description?: string
      priority?: TaskPriority
      project_id?: string | null
    }) => {
      const created = tasks.create({
        title: args.title,
        description: args.description ?? '',
        priority: args.priority ?? 'medium',
        projectId: args.project_id ?? null,
      })

      return text(`Created ${created.id}.`)
    },
  )

  return [listTasks, readTask, updateTask, commentOnTask, createTask]
}

/** One board line: enough to choose from, short enough to list fifty of. */
function summarise(task: Task, tasks: TaskTools): string {
  const who = task.assigneeId === null ? 'unassigned' : (tasks.agentName(task.assigneeId) ?? task.assigneeId)
  const project = task.projectId === null ? null : tasks.projectName(task.projectId)
  const trailer = project === null ? who : `${who} · ${project}`

  return `${task.id} [${task.status}] ${task.priority} — ${task.title} (${trailer})`
}

function describe(task: Task, tasks: TaskTools): string {
  const thread = tasks.comments(task.id)
  const lines = [
    `${task.id} — ${task.title}`,
    `Status: ${taskStatusLabel(task.status)}`,
    `Priority: ${taskPriorityLabel(task.priority)}`,
    `Assignee: ${task.assigneeId === null ? 'unassigned' : (tasks.agentName(task.assigneeId) ?? task.assigneeId)}`,
    `Project: ${task.projectId === null ? 'none' : (tasks.projectName(task.projectId) ?? 'none')}`,
    `Labels: ${task.labels.length === 0 ? 'none' : task.labels.join(', ')}`,
    '',
    task.description.trim() === '' ? '(no description)' : task.description,
  ]

  if (thread.length > 0) {
    lines.push('', 'Thread:')
    for (const entry of thread) lines.push(`- ${entry.author}: ${entry.text}`)
  }

  return lines.join('\n')
}

function firstLine(prompt: string): string {
  const line = prompt.split('\n')[0]?.trim() ?? ''
  return line === '' ? 'no system prompt' : line
}
