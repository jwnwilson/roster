import type { RunnerEvent } from './types'

export interface NormalizeOptions {
  /**
   * Whether the CLI was asked for partial messages.
   *
   * This is not cosmetic. With partial messages on, the SDK emits both the
   * incremental `stream_event` deltas *and* the complete `assistant` message
   * carrying the same text. Reading both would print every reply twice, so
   * exactly one source of prose is used: the deltas when streaming, the
   * complete message otherwise. Tool calls always come from the complete
   * message, since a half-parsed argument object is of no use.
   */
  streaming?: boolean
}

/**
 * Translates one Claude Agent SDK message into Roster events.
 *
 * Kept pure and separate from the adapter so it can be tested against
 * recorded output with no CLI, no network, and no SDK runtime.
 *
 * The SDK's message union is large and grows between releases, so this reads
 * defensively: anything unrecognised yields no events rather than throwing.
 */
export function normalizeClaudeMessage(
  message: unknown,
  options: NormalizeOptions = {},
): RunnerEvent[] {
  if (!isRecord(message)) return []

  switch (message['type']) {
    case 'assistant':
      return fromAssistant(message, options.streaming === true)
    case 'stream_event':
      return options.streaming === true ? fromStreamEvent(message) : []
    case 'user':
      return fromUser(message)
    case 'result':
      return fromResult(message)
    default:
      return []
  }
}

/** Incremental deltas. Only prose is surfaced; the design shows no thinking. */
function fromStreamEvent(message: Record<string, unknown>): RunnerEvent[] {
  const event = message['event']
  if (!isRecord(event) || event['type'] !== 'content_block_delta') return []

  const delta = event['delta']
  if (!isRecord(delta) || delta['type'] !== 'text_delta') return []

  const text = asString(delta['text'])
  return text === null || text === '' ? [] : [{ kind: 'text', delta: text }]
}

function fromAssistant(message: Record<string, unknown>, streaming: boolean): RunnerEvent[] {
  const inner = message['message']
  if (!isRecord(inner)) return []

  const content = inner['content']
  if (!Array.isArray(content)) return []

  const events: RunnerEvent[] = []

  for (const block of content) {
    if (!isRecord(block)) continue

    if (block['type'] === 'text' && typeof block['text'] === 'string') {
      // While streaming, this same text already arrived as deltas.
      if (streaming) continue
      // Empty deltas are noise on the wire; drop them.
      if (block['text'] !== '') events.push({ kind: 'text', delta: block['text'] })
      continue
    }

    if (block['type'] === 'tool_use') {
      const id = asString(block['id'])
      const name = asString(block['name'])
      if (id === null || name === null) continue
      events.push({ kind: 'tool', id, name, args: summariseArgs(block['input']) })
    }
  }

  return events
}

/** Tool results arrive as user-role messages carrying tool_result blocks. */
function fromUser(message: Record<string, unknown>): RunnerEvent[] {
  const inner = message['message']
  if (!isRecord(inner)) return []

  const content = inner['content']
  if (!Array.isArray(content)) return []

  const events: RunnerEvent[] = []

  for (const block of content) {
    if (!isRecord(block) || block['type'] !== 'tool_result') continue

    const id = asString(block['tool_use_id'])
    if (id === null) continue

    events.push({
      kind: 'result',
      id,
      output: flattenResultContent(block['content']),
      isError: block['is_error'] === true,
    })
  }

  return events
}

function fromResult(message: Record<string, unknown>): RunnerEvent[] {
  const events: RunnerEvent[] = []

  const usage = isRecord(message['usage']) ? message['usage'] : null
  const cost = message['total_cost_usd']

  if (usage !== null || typeof cost === 'number') {
    events.push({
      kind: 'usage',
      inputTokens: asNumber(usage?.['input_tokens']) ?? 0,
      outputTokens: asNumber(usage?.['output_tokens']) ?? 0,
      costUsd: typeof cost === 'number' ? cost : 0,
    })
  }

  // An error result still ends the turn, so report the failure and the done
  // event — otherwise the UI would sit on a spinner forever.
  if (message['subtype'] !== 'success' || message['is_error'] === true) {
    events.push({ kind: 'error', message: describeFailure(message) })
  }

  const sessionId = asString(message['session_id'])
  if (sessionId !== null) events.push({ kind: 'done', runnerSessionId: sessionId })

  return events
}

function describeFailure(message: Record<string, unknown>): string {
  const result = asString(message['result'])
  if (result !== null && result !== '') return result

  const subtype = asString(message['subtype'])
  return subtype !== null && subtype !== 'success' ? `run failed: ${subtype}` : 'run failed'
}

/** The collapsed tool row shows arguments inline, so they must be one line. */
export function summariseArgs(input: unknown): string {
  if (input === undefined || input === null) return ''
  if (typeof input === 'string') return input

  if (isRecord(input)) {
    // Bash and the file tools carry one field that is the whole story.
    for (const key of ['command', 'file_path', 'path', 'pattern', 'query', 'url']) {
      const value = input[key]
      if (typeof value === 'string' && value !== '') return value
    }
  }

  try {
    return JSON.stringify(input) ?? ''
  } catch {
    return ''
  }
}

/** tool_result content is either a string or an array of content blocks. */
function flattenResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((block) => {
      if (typeof block === 'string') return block
      if (isRecord(block) && typeof block['text'] === 'string') return block['text']
      return ''
    })
    .filter((text) => text !== '')
    .join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
