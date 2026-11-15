import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ModelInfo, RunnerStatus } from '../../../../shared/types'
import { isBrowserMcpTool } from '../../../../shared/mcp'
import { planInstruction } from '../../sessions/planPrompt'
import { rosterHome } from '../../store/paths'
import { describeCommand } from '../claude'
import { parseQuestions } from '../questions'
import type { BuiltinToolDefinition } from '../toolDefinitions'
import type { ApprovalDecision, Runner, RunnerEvent, StartOptions } from '../types'
import { resolveModel, toModelInfo } from './models'
import { createPiNormalizer, resultText, totalsFrom } from './normalize'

/**
 * Backs every agent with Pi, in process, through its SDK.
 *
 * Roster is a UI over Pi: Pi owns the agent loop, the model call, the tools
 * and the transcript; Roster decides what the agent may do and shows it.
 *
 * - Approvals are a Pi `tool_call` handler that does not return until the
 *   user has answered, so the gate is real rather than a notification.
 * - Roster's own tools (handoff, board, plans, memory) are plain Pi tools
 *   calling straight into the session manager — no MCP bridge.
 * - The CLI's session file is the resume handle, so a session survives a
 *   restart of Roster.
 */

/** Tools that only look. Everything else — shell, edits, MCP — asks first. */
const UNGATED_BUILTINS = new Set(['read', 'grep', 'find', 'ls'])

/** What planning may use: looking, and Roster's own tools. */
const PLAN_TOOLS = ['read', 'grep', 'find', 'ls']

/** Pi's defaults are read, bash, edit and write; the search tools are worth having. */
const EXTRA_TOOLS = ['+grep', '+find', '+ls']

type PiSdk = typeof import('@earendil-works/pi-coding-agent')

interface PendingApproval {
  resolve(decision: ApprovalDecision): void
}

/** Where Pi keeps the transcripts of Roster's sessions. */
export function piSessionsDir(): string {
  return join(rosterHome(), 'pi-sessions')
}

export class PiRunner implements Runner {
  readonly id = 'pi'

  private pending = new Map<string, PendingApproval>()
  private sdk: Promise<PiSdk> | null = null

  /** Imported lazily: tests that touch only the normalizer never load Pi. */
  private load(): Promise<PiSdk> {
    this.sdk ??= import('@earendil-works/pi-coding-agent')
    return this.sdk
  }

  /**
   * A fresh runtime per call, deliberately: it reads Pi's auth.json, and a
   * `/login` done in a terminal should be picked up without restarting Roster.
   */
  private async runtime() {
    const sdk = await this.load()
    return sdk.ModelRuntime.create()
  }

  async warmUp(): Promise<void> {
    await this.load()
  }

  async detect(): Promise<RunnerStatus> {
    try {
      const runtime = await this.runtime()
      const available = await runtime.getAvailable()
      const providers = [...new Set(available.map((model) => model.provider))]
      const subscription = providers.some((provider) => runtime.isUsingSubscription(provider))
      const sdk = await this.load()

      return {
        id: 'pi',
        provider: providers.length > 0 ? `Pi · ${providers.join(', ')}` : 'Pi',
        installed: true,
        ready: available.length > 0,
        auth: available.length === 0 ? 'none' : subscription ? 'subscription' : 'api-key',
        version: sdk.VERSION,
        ...(available.length === 0
          ? { detail: 'no model provider is signed in — run `pi` and then `/login`' }
          : {}),
      }
    } catch (cause) {
      return {
        id: 'pi',
        provider: 'Pi',
        installed: false,
        ready: false,
        auth: 'none',
        detail: `Pi could not start: ${describe(cause)}`,
      }
    }
  }

  async models(): Promise<ModelInfo[]> {
    try {
      const runtime = await this.runtime()
      return toModelInfo(await runtime.getAvailable())
    } catch {
      return []
    }
  }

  /** The `provider/id` Pi would choose with nothing named, or '' when none is usable. */
  async defaultModel(): Promise<string> {
    const models = await this.models()
    const sdk = await this.load()
    const settings = sdk.SettingsManager.create(process.cwd(), sdk.getAgentDir())
    const preferred = `${settings.getDefaultProvider() ?? ''}/${settings.getDefaultModel() ?? ''}`
    return models.find((model) => model.id === preferred)?.id ?? models[0]?.id ?? ''
  }

  async *run(prompt: string, options: StartOptions): AsyncIterable<RunnerEvent> {
    if (!existsSync(options.cwd)) {
      yield { kind: 'error', message: `working directory does not exist: ${options.cwd}` }
      yield { kind: 'done', runnerSessionId: options.resumeFrom ?? '' }
      return
    }

    const sdk = await this.load()
    const runtime = await sdk.ModelRuntime.create()
    const available = await runtime.getAvailable()
    const agentDir = sdk.getAgentDir()
    const settings = sdk.SettingsManager.create(options.cwd, agentDir)
    const model = resolveModel(options.model, available, {
      provider: settings.getDefaultProvider(),
      model: settings.getDefaultModel(),
    })

    if (!model) {
      yield {
        kind: 'error',
        message:
          available.length === 0
            ? 'Pi has no signed-in model provider — run `pi` and then `/login`'
            : `model "${options.model}" is not available in Pi — pick another in the agent's settings`,
      }
      yield { kind: 'done', runnerSessionId: options.resumeFrom ?? '' }
      return
    }

    // This turn's approvals, so ending it answers only its own — several
    // sessions can be waiting on the one runner at once.
    const owned = new Set<string>()

    const builtinTools = options.builtinTools ?? []
    const rosterToolNames = new Set(builtinTools.map((tool) => tool.name))

    const appendSystemPrompt = [
      options.systemPrompt.trim(),
      options.planMode === true ? planInstruction() : '',
    ].filter((part) => part !== '')

    const mcpServers = Object.entries(options.mcpServers).map(([name, spec]) => ({
      name,
      source: 'roster',
      scope: 'global' as const,
      config: {
        command: spec.command,
        args: spec.args,
        ...(Object.keys(spec.env).length > 0 ? { env: spec.env } : {}),
        exposure: 'direct' as const,
      },
    }))

    const loader = new sdk.DefaultResourceLoader({
      cwd: options.cwd,
      agentDir,
      // Roster owns this agent's configuration: its skills and MCP servers are
      // what agent.toml names, not whatever is in the user's ~/.pi. Project
      // context files (AGENTS.md and friends) still load — they are the repo's.
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      additionalSkillPaths: options.skills.map((skill) => skill.path),
      appendSystemPrompt,
      extensionFactories: [
        (pi) => {
          pi.on('tool_call', async (event) => {
            if (
              UNGATED_BUILTINS.has(event.toolName) ||
              rosterToolNames.has(event.toolName) ||
              // A browser check is dozens of clicks; asking for each would
              // make one unusable. The browser is headless with a throwaway
              // profile, and the agent only has it if it was given it.
              isBrowserMcpTool(event.toolName)
            ) {
              return undefined
            }
            if (options.signal.aborted) return { block: true, reason: 'The run was stopped' }
            const decision = await this.requestApproval(
              event.toolName,
              toRecord(event.input),
              owned,
              options.onApproval,
            )
            return decision.approved
              ? undefined
              : { block: true, reason: decision.reason ?? 'Denied by the user' }
          })
        },
        ...(mcpServers.length > 0
          ? [sdk.createMcpExtension({ loadConfig: () => ({ servers: mcpServers, errors: [] }) })]
          : []),
      ],
    })
    await loader.reload()

    const sessionManager =
      options.resumeFrom !== undefined && existsSync(options.resumeFrom)
        ? options.fork === true
          ? sdk.SessionManager.forkFrom(options.resumeFrom, options.cwd, piSessionsDir())
          : sdk.SessionManager.open(options.resumeFrom, piSessionsDir(), options.cwd)
        : sdk.SessionManager.create(options.cwd, piSessionsDir())

    const { session } = await sdk.createAgentSession({
      cwd: options.cwd,
      agentDir,
      modelRuntime: runtime,
      model,
      resourceLoader: loader,
      sessionManager,
      // In-memory: compaction and retries on, nothing from the user's own Pi
      // settings changing what an agent does behind Roster's back.
      settingsManager: sdk.SettingsManager.inMemory({}),
      tools:
        options.planMode === true
          ? [...PLAN_TOOLS, ...rosterToolNames]
          : EXTRA_TOOLS,
      customTools: builtinTools.map(toPiTool),
    })

    const queue = new EventQueue<RunnerEvent>()
    const normalizer = createPiNormalizer(totalsFrom(session.messages))
    const unsubscribe = session.subscribe((event) => {
      for (const out of normalizer.handle(event)) queue.push(out)
    })

    const onAbort = (): void => {
      // An approval still open would hold the tool call, and with it the
      // abort, until somebody answered it.
      this.failApprovals(owned, 'The run was stopped')
      void session.abort()
    }
    if (options.signal.aborted) onAbort()
    else options.signal.addEventListener('abort', onAbort, { once: true })

    try {
      if (mcpServers.length > 0) await session.bindExtensions({})

      const sessionFile = session.sessionFile ?? ''
      if (sessionFile !== '') queue.push({ kind: 'session', runnerSessionId: sessionFile })

      const turn = session
        .prompt(prompt)
        .catch((cause: unknown) => {
          if (!options.signal.aborted) queue.push({ kind: 'error', message: describe(cause) })
        })
        .finally(() => queue.close())

      for await (const event of queue) yield event
      await turn

      yield { kind: 'done', runnerSessionId: session.sessionFile ?? sessionFile }
    } finally {
      options.signal.removeEventListener('abort', onAbort)
      unsubscribe()
      this.failApprovals(owned, 'The run ended before you answered')
      session.dispose()
    }
  }

  respondToApproval(approvalId: string, decision: ApprovalDecision): void {
    const pending = this.pending.get(approvalId)
    if (!pending) return
    this.pending.delete(approvalId)
    pending.resolve(decision)
  }

  private requestApproval(
    toolName: string,
    input: Record<string, unknown>,
    owned: Set<string>,
    raise: StartOptions['onApproval'],
  ): Promise<ApprovalDecision> {
    // Nobody to ask means nobody can say yes.
    if (!raise) return Promise.resolve({ approved: false, reason: 'No one is available to approve this' })
    const id = randomUUID()
    owned.add(id)
    const questions = parseQuestions(input['questions'])

    return new Promise((resolve) => {
      this.pending.set(id, { resolve })
      raise({
        kind: 'approval',
        id,
        toolName,
        command: describeCommand(toolName, input),
        ...(questions !== null ? { questions } : {}),
      })
    })
  }

  private failApprovals(ids: Set<string>, reason: string): void {
    for (const id of ids) this.respondToApproval(id, { approved: false, reason })
    ids.clear()
  }
}

/**
 * One of Roster's tools as a Pi tool.
 *
 * The definitions carry zod shapes; Pi wants JSON Schema, which is what the
 * Codex bridge already produced from the same shapes, so the arguments are
 * checked against the zod schema here before the handler sees them.
 */
export function toPiTool(definition: BuiltinToolDefinition) {
  const schema = z.object(definition.inputSchema as z.ZodRawShape)
  const parameters = z.toJSONSchema(schema) as Record<string, unknown>
  delete parameters['$schema']

  return {
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: parameters as never,
    async execute(_toolCallId: string, params: unknown) {
      const parsed = schema.safeParse(params ?? {})
      if (!parsed.success) {
        throw new Error(`invalid arguments for ${definition.name}: ${parsed.error.message}`)
      }
      const result = await definition.handler(parsed.data as never, {})
      const text = resultText(result)
      if (result.isError === true) throw new Error(text === '' ? `${definition.name} failed` : text)
      return { content: [{ type: 'text' as const, text }], details: {} }
    },
  }
}

/** A push-to-pull bridge: Pi delivers events by callback, the runner yields them. */
export class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiting: ((result: IteratorResult<T>) => void) | null = null
  private closed = false

  push(item: T): void {
    if (this.closed) return
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: item, done: false })
    } else {
      this.items.push(item)
    }
  }

  close(): void {
    this.closed = true
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: undefined as never, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item !== undefined) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => {
          this.waiting = resolve
        })
      },
    }
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
