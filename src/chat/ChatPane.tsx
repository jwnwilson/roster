import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ComposerPrimitive } from '@assistant-ui/react'
import type { Message } from '@shared/types'
import { MessageView } from './messages'

interface ChatPaneProps {
  sessionId: string
  agentName: string
  messages: Message[]
  isStreaming: boolean
  streamingText: string
  skillsLine: string
  onSend: (prompt: string) => void
  onCancel: () => void
}

export function ChatPane({
  sessionId,
  agentName,
  messages,
  isStreaming,
  streamingText,
  skillsLine,
  onSend,
  onCancel,
}: ChatPaneProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')

  // The handoff pins the transcript to the bottom whenever the session or
  // mode changes, and as new messages land.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sessionId, messages.length, isStreaming])

  useEffect(() => setDraft(''), [sessionId])

  function submit(): void {
    const prompt = draft.trim()
    if (prompt === '' || isStreaming) return
    setDraft('')
    onSend(prompt)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto px-[26px] pt-[22px] pb-[8px]"
      >
        {messages.length === 0 && !isStreaming ? (
          <p className="m-0 text-md text-dim">
            Nothing here yet — send {agentName} a message to start this session.
          </p>
        ) : null}

        {messages.map((message) => (
          <MessageView key={message.id} message={message} agentName={agentName} />
        ))}

        {isStreaming ? <StreamingRow text={streamingText} onCancel={onCancel} /> : null}
      </div>

      <div className="flex-none border-t border-line bg-sunken px-[26px] pt-[12px] pb-[16px]">
        <div className="flex flex-col gap-[9px] rounded-[9px] border border-line-card bg-card px-[12px] py-[10px]">
          <div className="flex gap-[7px]">
            <span className="flex items-center gap-[6px] rounded-sm border border-dashed border-line-active px-[8px] py-[3px] text-sm text-dim-2">
              drop files here
            </span>
          </div>

          <textarea
            value={draft}
            rows={2}
            aria-label={`Message ${agentName}`}
            placeholder={`Message ${agentName}…`}
            disabled={isStreaming}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            className="w-full resize-none border-0 bg-transparent font-ui text-xl leading-[1.5] text-ink outline-none placeholder:text-faint disabled:opacity-60"
          />

          <div className="flex items-center gap-[8px]">
            <span className="truncate font-mono text-sm text-faint">{skillsLine}</span>
            <button
              type="button"
              onClick={submit}
              disabled={draft.trim() === '' || isStreaming}
              className="ml-auto cursor-pointer rounded-chip border-0 bg-accent px-[12px] py-[4px] font-ui text-md font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export interface StreamingRowProps {
  text: string
  onCancel: () => void
}

export function StreamingRow({ text, onCancel }: StreamingRowProps) {
  return (
    <div className="flex items-center gap-[8px] text-md text-dim">
      <span
        aria-hidden
        className="h-[6px] w-[6px] rounded-full bg-accent"
        style={{ animation: 'var(--animate-blink)' }}
      />
      <span>{text}</span>
      <button
        type="button"
        onClick={onCancel}
        className="ml-[6px] cursor-pointer rounded-sm border border-line-dashed bg-transparent px-[9px] py-[2px] font-ui text-sm text-dim hover:border-[#55596a] hover:text-ink"
        data-hoverable
      >
        Stop
      </button>
    </div>
  )
}

/* -------------------------------------------------------------------------
 * The same composer, driven by assistant-ui's composer runtime rather than
 * local state, so the markup does not fork between the two panes.
 * ---------------------------------------------------------------------- */

interface ComposerProps {
  agentName: string
  skillsLine: string
  disabled: boolean
}

export function Composer({ agentName, skillsLine, disabled }: ComposerProps) {
  return (
    <div className="flex-none border-t border-line bg-sunken px-[26px] pt-[12px] pb-[16px]">
      <ComposerPrimitive.Root className="flex flex-col gap-[9px] rounded-[9px] border border-line-card bg-card px-[12px] py-[10px]">
        <div className="flex gap-[7px]">
          <span className="flex items-center gap-[6px] rounded-sm border border-dashed border-line-active px-[8px] py-[3px] text-sm text-dim-2">
            drop files here
          </span>
        </div>

        <ComposerPrimitive.Input
          rows={2}
          autoFocus={false}
          disabled={disabled}
          aria-label={`Message ${agentName}`}
          placeholder={`Message ${agentName}…`}
          className="w-full resize-none border-0 bg-transparent font-ui text-xl leading-[1.5] text-ink outline-none placeholder:text-faint disabled:opacity-60"
        />

        <div className="flex items-center gap-[8px]">
          <span className="truncate font-mono text-sm text-faint">{skillsLine}</span>
          <ComposerPrimitive.Send
            disabled={disabled}
            className="ml-auto cursor-pointer rounded-chip border-0 bg-accent px-[12px] py-[4px] font-ui text-md font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
          >
            Send
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </div>
  )
}
