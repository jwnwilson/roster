import type { RunnerEvent } from '../types'
import { embeddedImageUrl } from '../../../../shared/images'

/**
 * Translates Pi's session events into Roster's runner vocabulary.
 *
 * Pure and stateful per turn: Pi reports usage per assistant message, while
 * Roster stores one running total per session, so the normalizer folds every
 * assistant message it sees into that total. Seeded with what the session had
 * already spent, because a resumed session's earlier turns are still its cost.
 */

/** The subset of a Pi usage record Roster reads. */
export interface PiUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
  cost?: { total?: number }
}

export interface UsageTotals {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
}

export const EMPTY_TOTALS: UsageTotals = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
}

/** Adds one assistant message's usage to a running total, without mutating it. */
export function addUsage(totals: UsageTotals, usage: PiUsage | undefined): UsageTotals {
  if (!usage) return totals
  const input = usage.input ?? 0
  const output = usage.output ?? 0
  const cacheRead = usage.cacheRead ?? 0
  const cacheWrite = usage.cacheWrite ?? 0
  return {
    inputTokens: totals.inputTokens + input,
    cachedInputTokens: totals.cachedInputTokens + cacheRead,
    outputTokens: totals.outputTokens + output,
    totalTokens: totals.totalTokens + (usage.totalTokens ?? input + output + cacheRead + cacheWrite),
    costUsd: totals.costUsd + (usage.cost?.total ?? 0),
  }
}

/** Sums the usage of every assistant message in a transcript. */
export function totalsFrom(messages: readonly unknown[]): UsageTotals {
  return messages.reduce<UsageTotals>((totals, message) => {
    if (!isRecord(message) || message['role'] !== 'assistant') return totals
    return addUsage(totals, message['usage'] as PiUsage | undefined)
  }, EMPTY_TOTALS)
}

export interface PiNormalizer {
  handle(event: unknown): RunnerEvent[]
  totals(): UsageTotals
}

/**
 * Tools whose handler writes its own transcript row. `propose_plan` records
 * the plan card itself (the Codex path needed that); a tool row from the
 * stream as well would show the plan twice.
 */
const SELF_RECORDING_TOOLS = new Set(['propose_plan'])

export function createPiNormalizer(initial: UsageTotals = EMPTY_TOTALS): PiNormalizer {
  let totals = initial
  const silenced = new Set<string>()

  return {
    totals: () => totals,
    handle(event) {
      if (!isRecord(event)) return []

      switch (event['type']) {
        case 'message_update': {
          const inner = event['assistantMessageEvent']
          if (isRecord(inner) && inner['type'] === 'text_delta' && typeof inner['delta'] === 'string') {
            return inner['delta'] === '' ? [] : [{ kind: 'text', delta: inner['delta'] }]
          }
          return []
        }

        case 'tool_execution_start': {
          const id = asString(event['toolCallId'])
          const name = asString(event['toolName'])
          if (id === '' || name === '') return []
          if (SELF_RECORDING_TOOLS.has(name)) {
            silenced.add(id)
            return []
          }
          const input = isRecord(event['args']) ? event['args'] : {}
          return [{ kind: 'tool', id, name, args: describeArgs(name, input), input: JSON.stringify(input, null, 2) }]
        }

        case 'tool_execution_end': {
          const id = asString(event['toolCallId'])
          if (id === '' || silenced.delete(id)) return []
          const images = resultImages(event['result'])
          return [
            {
              kind: 'result',
              id,
              output: resultText(event['result']),
              isError: event['isError'] === true,
              ...(images.length > 0 ? { images } : {}),
            },
          ]
        }

        case 'message_end': {
          const message = event['message']
          if (!isRecord(message) || message['role'] !== 'assistant') return []

          const out: RunnerEvent[] = []
          totals = addUsage(totals, message['usage'] as PiUsage | undefined)
          out.push({ kind: 'usage', ...totals })

          // A provider failure ends the message rather than throwing, so it
          // has to be surfaced here or the turn just goes quiet.
          if (message['stopReason'] === 'error') {
            const reason = asString(message['errorMessage'])
            out.push({ kind: 'error', message: reason === '' ? 'the model request failed' : reason })
          }
          return out
        }

        default:
          return []
      }
    },
  }
}

/** The one line a collapsed tool row shows. */
export function describeArgs(name: string, input: Record<string, unknown>): string {
  for (const key of ['command', 'path', 'file_path', 'pattern', 'query', 'url']) {
    const value = input[key]
    if (typeof value === 'string' && value !== '') return value
  }
  const keys = Object.keys(input)
  if (keys.length === 0) return ''
  const json = JSON.stringify(input)
  return json.length > 120 ? `${json.slice(0, 117)}...` : json || name
}

/**
 * A tool result's text content, joined. An image the chat can show is left to
 * resultImages; anything else that is not text is named.
 */
export function resultText(result: unknown): string {
  if (!isRecord(result)) return typeof result === 'string' ? result : ''
  const content = result['content']
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!isRecord(part)) return ''
      if (part['type'] === 'text' && typeof part['text'] === 'string') return part['text']
      if (part['type'] === 'image' && embeddedImageUrl(part['mimeType'], part['data']) !== null) return ''
      return `[${String(part['type'] ?? 'content')}]`
    })
    .filter((text) => text !== '')
    .join('\n')
}

/** Pictures in a tool result the chat can show, as data URLs. */
export function resultImages(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result['content'])) return []
  return result['content'].flatMap((part) => {
    if (!isRecord(part) || part['type'] !== 'image') return []
    const url = embeddedImageUrl(part['mimeType'], part['data'])
    return url === null ? [] : [url]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
