import { useMemo } from 'react'
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useExternalStoreRuntime,
} from '@assistant-ui/react'
import type { HandoffMessage, Message, Question, SpawnMessage } from '@shared/types'
import { toThreadMessage, type RosterHeader } from './convert'
import { Composer, StreamingRow } from './Composer'
import { HandoffBody, SpawnBody, TextBody, ToolBody, MessageHeader } from './messages'
import { QuestionCard } from './QuestionCard'

interface AssistantChatPaneProps {
  sessionId: string
  agentName: string
  messages: Message[]
  isStreaming: boolean
  streamingText: string
  skillsLine: string
  /** What the agent is waiting to be told, when it asked rather than acted. */
  questions?: Question[]
  onAnswer: (answers: Record<string, string>) => void
  onSkipQuestions: () => void
  planMode: boolean
  onTogglePlanMode: () => void
  onSend: (prompt: string) => void
  onCancel: () => void
}

/**
 * The chat pane, running on assistant-ui.
 *
 * SQLite remains the source of truth: the external-store runtime renders
 * whatever Roster hands it and calls back out to send and cancel. Roster's
 * own components render every part, so nothing of assistant-ui's default
 * styling reaches the screen.
 */
export function AssistantChatPane({
  sessionId,
  agentName,
  messages,
  isStreaming,
  streamingText,
  skillsLine,
  questions,
  onAnswer,
  onSkipQuestions,
  planMode,
  onTogglePlanMode,
  onSend,
  onCancel,
}: AssistantChatPaneProps) {
  // Roster's own messages stay the store; the converter is what assistant-ui
  // renders from, so SQLite remains the single source of truth.
  const convertMessage = useMemo(() => toThreadMessage, [])

  const runtime = useExternalStoreRuntime<Message>({
    messages,
    convertMessage,
    isRunning: isStreaming,
    onNew: async (message) => {
      const text = message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
        .trim()
      if (text !== '') onSend(text)
    },
    onCancel: async () => onCancel(),
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
        <ThreadPrimitive.Viewport
          className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto px-[26px] pt-[22px] pb-[8px]"
          autoScroll
        >
          <ThreadPrimitive.Empty>
            <p className="m-0 text-md text-dim">
              Nothing here yet — send {agentName} a message to start this session.
            </p>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages components={{ Message: RosterMessage }} />

          {isStreaming ? <StreamingRow text={streamingText} onCancel={onCancel} /> : null}

          {/* Below the transcript, where the question was asked — not in the
              banner, which has room for one line and two buttons. */}
          {questions ? (
            <QuestionCard
              questions={questions}
              onAnswer={onAnswer}
              onSkip={onSkipQuestions}
            />
          ) : null}
        </ThreadPrimitive.Viewport>

        <Composer
          agentName={agentName}
          skillsLine={skillsLine}
          disabled={isStreaming}
          planMode={planMode}
          onTogglePlanMode={onTogglePlanMode}
        />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  )
}

/**
 * One message, dispatched by part type. `data-spawn` and `data-handoff` are
 * Roster's own kinds; the rest are assistant-ui's.
 */
function RosterMessage() {
  const header = useAuiState(
    (s) => (s.message.metadata?.custom as { header?: RosterHeader } | undefined)?.header ?? null,
  )
  const durationMs = useAuiState(
    (s) => (s.message.metadata?.custom as { durationMs?: number } | undefined)?.durationMs,
  )
  const toolInput = useAuiState(
    (s) => (s.message.metadata?.custom as { input?: string } | undefined)?.input,
  )

  return (
    <MessagePrimitive.Root className="flex max-w-[720px] flex-col gap-[7px]">
      {header ? (
        <MessageHeader who={header.who} time={header.time} isUser={header.isUser} />
      ) : null}
      <MessagePrimitive.Parts>
        {({ part }) => {
          switch (part.type) {
            case 'text':
              return <TextBody text={part.text} />
            case 'tool-call':
              return (
                <ToolBody
                  id={part.toolCallId}
                  tool={part.toolName}
                  args={part.argsText ?? ''}
                  output={typeof part.result === 'string' ? part.result : ''}
                  isError={part.isError === true}
                  {...(toolInput !== undefined ? { input: toolInput } : {})}
                  {...(durationMs !== undefined ? { durationMs } : {})}
                />
              )
            // A `data-<name>` part surfaces here as type "data" with the
            // suffix in `name`, which is how Roster's own kinds arrive.
            case 'data':
              if (part.name === 'spawn') {
                return <SpawnBody message={part.data as SpawnMessage} />
              }
              if (part.name === 'handoff') {
                return <HandoffBody message={part.data as HandoffMessage} />
              }
              return null
            default:
              return null
          }
        }}
      </MessagePrimitive.Parts>
    </MessagePrimitive.Root>
  )
}

export { MessageHeader }
