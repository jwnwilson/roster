import type { ThreadMessageLike } from '@assistant-ui/react'
import type { Message } from '@shared/types'

/**
 * The header (who + timestamp) is per-message chrome, not a part, so it is
 * carried in metadata for the message component to render.
 */
export interface RosterHeader {
  who: string
  time: number
  isUser: boolean
}

export function headerFor(message: Message): RosterHeader {
  switch (message.kind) {
    case 'text':
      return { who: message.who, time: message.createdAt, isUser: message.role === 'user' }
    case 'tool':
      return { who: 'tool call', time: message.createdAt, isUser: false }
    case 'spawn':
      return { who: `session opened by ${message.from}`, time: message.createdAt, isUser: false }
    case 'handoff':
      return { who: 'opened sessions', time: message.createdAt, isUser: false }
  }
}

/**
 * Converts a Roster message into the shape assistant-ui renders.
 *
 * Text and tool calls map onto its own part kinds. Spawn and handoff have no
 * equivalent, so they use `data-*` parts — assistant-ui's documented
 * extension point for content it does not model — which keeps them
 * first-class rather than smuggled inside a tool call.
 */
export function toThreadMessage(message: Message): ThreadMessageLike {
  switch (message.kind) {
    case 'text':
      return {
        id: message.id,
        role: message.role,
        createdAt: new Date(message.createdAt),
        content: [{ type: 'text', text: message.text }],
        metadata: { custom: { header: headerFor(message) } },
      }

    case 'tool':
      return {
        id: message.id,
        role: 'assistant',
        createdAt: new Date(message.createdAt),
        content: [
          {
            type: 'tool-call',
            toolCallId: message.id,
            toolName: message.tool,
            argsText: message.args,
            // A tool still running has no result yet; assistant-ui shows it
            // as pending rather than as an empty result.
            ...(message.output === ''
              ? {}
              : { result: message.output, isError: message.isError }),
          },
        ],
        // assistant-ui's tool-call part carries only argsText, so the full
        // call rides alongside the duration in the message's own metadata.
        metadata: {
          custom: {
            header: headerFor(message),
            durationMs: message.durationMs,
            input: message.input,
            planId: message.planId,
          },
        },
      }

    case 'spawn':
      return {
        id: message.id,
        role: 'assistant',
        createdAt: new Date(message.createdAt),
        content: [{ type: 'data-spawn', data: message }],
        metadata: { custom: { header: headerFor(message) } },
      }

    case 'handoff':
      return {
        id: message.id,
        role: 'assistant',
        createdAt: new Date(message.createdAt),
        content: [{ type: 'data-handoff', data: message }],
        metadata: { custom: { header: headerFor(message) } },
      }
  }
}

/** Narrows a `data-*` part back to the Roster message it carries. */
export function messageFromDataPart(part: { type: string; data?: unknown }): Message | null {
  if (part.type !== 'data-spawn' && part.type !== 'data-handoff') return null
  return (part.data as Message | undefined) ?? null
}
