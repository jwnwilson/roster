import type { HandoffLink, HandoffMessage, Message, SessionRef, SpawnMessage } from '@shared/types'
import { statusColor } from '@shared/status'
import { useRoster } from '@/state/store'

/* -------------------------------------------------------------------------
 * Message renderers.
 *
 * Split into a header and per-kind bodies so the same markup serves both the
 * plain transcript and the assistant-ui runtime, which supplies its own
 * message wrapper and dispatches by part type.
 * ---------------------------------------------------------------------- */

interface MessageHeaderProps {
  who: string
  time: number
  isUser?: boolean
}

export function MessageHeader({ who, time, isUser = false }: MessageHeaderProps) {
  return (
    <div className="flex items-center gap-[8px]">
      <span
        className="text-sm font-semibold uppercase tracking-[0.04em]"
        style={{ color: isUser ? 'var(--color-muted-2)' : 'var(--color-accent)' }}
      >
        {who}
      </span>
      <time className="font-mono text-sm text-faint-2">{formatTime(time)}</time>
    </div>
  )
}

/* ---- bodies ----------------------------------------------------------- */

export function TextBody({ text }: { text: string }) {
  return (
    <p className="m-0 text-2xl leading-[1.62] whitespace-pre-wrap text-ink-2">{text}</p>
  )
}

interface ToolBodyProps {
  id: string
  tool: string
  args: string
  output: string
  isError: boolean
  durationMs?: number
}

export function ToolBody({ id, tool, args, output, isError, durationMs }: ToolBodyProps) {
  const open = useRoster((s) => s.openTools[id] ?? false)
  const toggleTool = useRoster((s) => s.toggleTool)
  const running = output === '' && !isError

  return (
    <div
      className="overflow-hidden rounded-field border border-line-input bg-card hover:border-line-hover"
      data-hoverable
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => toggleTool(id)}
        className="flex w-full cursor-pointer items-center gap-[9px] border-0 bg-transparent px-[11px] py-[8px] text-left"
      >
        <span aria-hidden className="text-2xs text-dim">
          {open ? '▾' : '▸'}
        </span>
        <span className="font-mono text-base text-accent-light">{tool}</span>
        <span className="truncate font-mono text-base text-[#7d8090]">{args}</span>
        <span className="ml-auto flex-none font-mono text-xs text-faint-2">
          {running ? '…' : formatDuration(durationMs)}
        </span>
      </button>
      {open ? (
        <pre className="m-0 border-t border-line bg-well px-[12px] py-[10px] font-mono text-base leading-[1.6] whitespace-pre-wrap text-muted-2">
          {output === '' ? 'no output' : output}
        </pre>
      ) : null}
    </div>
  )
}

export function SpawnBody({ message }: { message: SpawnMessage }) {
  return (
    <div className="flex flex-col items-start gap-[8px] border-l-2 border-accent-line py-[2px] pl-[13px]">
      <p className="m-0 text-2xl leading-[1.62] text-[#b3b6c2]">{message.text}</p>
      {message.to ? <BackPill target={message.to} /> : null}
    </div>
  )
}

export function HandoffBody({ message }: { message: HandoffMessage }) {
  return (
    <div className="flex flex-col items-start gap-[6px]">
      {message.links.map((link) => (
        <HandoffPill key={`${link.agentId}:${link.sessionId}`} link={link} />
      ))}
    </div>
  )
}

function BackPill({ target }: { target: SessionRef }) {
  const openAgent = useRoster((s) => s.openAgent)

  return (
    <button
      type="button"
      onClick={() => openAgent(target.agentId, target.sessionId)}
      className="cursor-pointer rounded-chip border border-accent-line-2 bg-accent-surface-2 px-[10px] py-[4px] text-base text-accent-light hover:border-accent"
      data-hoverable
    >
      ↖ {target.label}
    </button>
  )
}

function HandoffPill({ link }: { link: HandoffLink }) {
  const openAgent = useRoster((s) => s.openAgent)

  return (
    <button
      type="button"
      onClick={() => openAgent(link.agentId, link.sessionId)}
      className="flex cursor-pointer items-center gap-[9px] rounded-pill border border-accent-line-2 bg-accent-surface-2 px-[11px] py-[6px] text-lg text-accent-text hover:border-accent"
      data-hoverable
    >
      <span>↳ {link.label}</span>
      <span
        aria-hidden
        className="h-[6px] w-[6px] flex-none rounded-full"
        style={{ background: statusColor(link.status) }}
      />
    </button>
  )
}

/* ---- whole message (plain transcript) --------------------------------- */

interface MessageViewProps {
  message: Message
  agentName: string
}

export function MessageView({ message, agentName }: MessageViewProps) {
  switch (message.kind) {
    case 'text':
      return (
        <article className="flex max-w-[720px] flex-col gap-[7px]">
          <MessageHeader
            who={message.who}
            time={message.createdAt}
            isUser={message.role === 'user'}
          />
          <TextBody text={message.text} />
        </article>
      )

    case 'tool':
      return (
        <article className="flex max-w-[720px] flex-col gap-[7px]">
          <MessageHeader who="tool call" time={message.createdAt} />
          <ToolBody
            id={message.id}
            tool={message.tool}
            args={message.args}
            output={message.output}
            isError={message.isError}
            {...(message.durationMs !== undefined ? { durationMs: message.durationMs } : {})}
          />
        </article>
      )

    case 'spawn':
      return (
        <article className="flex max-w-[720px] flex-col gap-[7px]">
          <MessageHeader who={`session opened by ${message.from}`} time={message.createdAt} />
          <SpawnBody message={message} />
          <span className="sr-only">{agentName}</span>
        </article>
      )

    case 'handoff':
      return (
        <article className="flex max-w-[720px] flex-col gap-[7px]">
          <MessageHeader who="opened sessions" time={message.createdAt} />
          <HandoffBody message={message} />
        </article>
      )
  }
}

/* ---- formatting ------------------------------------------------------- */

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms < 1_000) return `${ms}ms`
  return `${(ms / 1_000).toFixed(1)}s`
}
