import type { RunnerEvent } from './types'

/**
 * Translates one line of `codex exec --json` output into Roster events.
 *
 * Recorded from Codex CLI 0.147.0, whose stream is:
 *   {"type":"thread.started","thread_id":"…"}
 *   {"type":"turn.started"}
 *   {"type":"item.started","item":{…}}
 *   {"type":"item.completed","item":{…}}
 *   {"type":"turn.completed","usage":{…}}
 *
 * Items carry their own `type`: `agent_message`, `command_execution`, and
 * others. Like the Claude normalizer this is pure and defensive — an
 * unrecognised line yields nothing rather than throwing.
 */
export function normalizeCodexMessage(message: unknown): RunnerEvent[] {
  if (!isRecord(message)) return []

  switch (asString(message['type'])) {
    case 'thread.started':
      return fromThreadStarted(message)
    case 'item.started':
      return fromItem(message, 'started')
    case 'item.completed':
      return fromItem(message, 'completed')
    case 'turn.completed':
      return fromTurnCompleted(message)
    case 'turn.failed':
      return fromTurnFailed(message)
    case 'error':
      return [{ kind: 'error', message: asString(message['message']) ?? 'codex reported an error' }]
    default:
      return []
  }
}

/**
 * The thread id is what `codex exec resume` takes, so it is Roster's runner
 * session id. It arrives first, not last — unlike Claude, which reports its
 * session id on the result.
 */
function fromThreadStarted(message: Record<string, unknown>): RunnerEvent[] {
  const threadId = asString(message['thread_id'])
  return threadId === null ? [] : [{ kind: 'session', runnerSessionId: threadId }]
}

function fromItem(message: Record<string, unknown>, phase: 'started' | 'completed'): RunnerEvent[] {
  const item = message['item']
  if (!isRecord(item)) return []

  const id = asString(item['id'])
  if (id === null) return []

  switch (asString(item['type'])) {
    case 'agent_message': {
      // Only the completed item carries final text; the started one is empty.
      if (phase !== 'completed') return []
      const text = asString(item['text'])
      return text === null || text === '' ? [] : [{ kind: 'text', delta: text }]
    }

    case 'command_execution':
      return phase === 'started'
        ? [{ kind: 'tool', id, name: 'shell', args: asString(item['command']) ?? '' }]
        : [
            {
              kind: 'result',
              id,
              output: asString(item['aggregated_output']) ?? '',
              isError: asNumber(item['exit_code']) !== 0,
            },
          ]

    case 'file_change':
      return phase === 'started'
        ? [{ kind: 'tool', id, name: 'edit', args: describeFileChange(item) }]
        : [{ kind: 'result', id, output: describeFileChange(item), isError: false }]

    default:
      return []
  }
}

function describeFileChange(item: Record<string, unknown>): string {
  const changes = item['changes']
  if (Array.isArray(changes)) {
    const paths = changes
      .map((change) => (isRecord(change) ? asString(change['path']) : null))
      .filter((path): path is string => path !== null)
    if (paths.length > 0) return paths.join(', ')
  }
  return asString(item['path']) ?? 'file change'
}

function fromTurnCompleted(message: Record<string, unknown>): RunnerEvent[] {
  const events: RunnerEvent[] = []
  const usage = message['usage']

  if (isRecord(usage)) {
    const inputTokens = asNumber(usage['input_tokens']) ?? 0
    const outputTokens = asNumber(usage['output_tokens']) ?? 0

    events.push({
      kind: 'usage',
      inputTokens,
      outputTokens,
      // Unlike Claude, Codex's cached_input_tokens is how many of
      // input_tokens were cache hits — already counted, so adding it would
      // double them. reasoning_output_tokens sits inside output_tokens too.
      totalTokens: inputTokens + outputTokens,
      // Codex reports no dollar figure; spend is tracked by the vendor.
      costUsd: 0,
    })
  }

  // The thread id already arrived on thread.started, so this only ends the turn.
  events.push({ kind: 'done', runnerSessionId: '' })
  return events
}

function fromTurnFailed(message: Record<string, unknown>): RunnerEvent[] {
  const error = message['error']
  const detail = isRecord(error) ? asString(error['message']) : asString(message['message'])

  return [
    { kind: 'error', message: detail ?? 'the codex turn failed' },
    { kind: 'done', runnerSessionId: '' },
  ]
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
