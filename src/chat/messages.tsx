import type { HandoffLink, HandoffMessage, SessionRef, SpawnMessage } from '@shared/types'
import { statusColor } from '@shared/status'
import { useRoster } from '@/state/store'
import { Markdown } from '@/components/Markdown'

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

/**
 * Chat prose, rendered as Markdown.
 *
 * The handoff specifies plain text preserving newlines, which is what the
 * prototype's hand-written demo messages needed. Real agents write Markdown
 * — fenced code, links, lists — and printing the backticks verbatim is not
 * what either side meant. Same renderer the task board uses, so a fence
 * looks the same wherever an agent wrote it.
 */
export function TextBody({ text }: { text: string }) {
  return <Markdown>{text}</Markdown>
}

interface ToolBodyProps {
  id: string
  tool: string
  args: string
  /** The full call, when the summary on the row is not all of it. */
  input?: string
  output: string
  isError: boolean
  durationMs?: number
}

export function ToolBody({ id, tool, args, input, output, isError, durationMs }: ToolBodyProps) {
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
        <div className="border-t border-line bg-well px-[12px] py-[10px]">
          {input === undefined ? null : (
            <>
              <ToolSectionLabel>Arguments</ToolSectionLabel>
              <ToolPre>{prettyArgs(input)}</ToolPre>
            </>
          )}
          <ToolSectionLabel className={input === undefined ? '' : 'mt-[10px]'}>
            Output
          </ToolSectionLabel>
          <ToolPre>{output === '' ? 'no output' : output}</ToolPre>
        </div>
      ) : null}
    </div>
  )
}

function ToolSectionLabel({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div
      className={`text-2xs font-semibold uppercase tracking-[0.07em] text-faint-2 ${className}`}
    >
      {children}
    </div>
  )
}

function ToolPre({ children }: { children: string }) {
  return (
    <pre className="m-0 font-mono text-base leading-[1.6] whitespace-pre-wrap text-muted-2">
      {children}
    </pre>
  )
}

/**
 * The call as something worth expanding to.
 *
 * The collapsed row is one truncated line, so for a tool whose arguments are
 * a structure — a question and its options, a patch, a filter — that line is
 * all anyone ever sees of them. Indenting the JSON is what makes the rest
 * readable; anything that is not JSON is passed through.
 */
export function prettyArgs(args: string): string {
  try {
    const parsed: unknown = JSON.parse(args)
    if (typeof parsed !== 'object' || parsed === null) return args

    // One text field — a plan, a file body — reads as itself. As JSON its
    // every newline would come back as a literal \n.
    const keys = Object.keys(parsed as Record<string, unknown>)
    const only = keys.length === 1 ? (parsed as Record<string, unknown>)[keys[0]!] : null
    if (typeof only === 'string') return only

    return JSON.stringify(parsed, null, 2)
  } catch {
    return args
  }
}

export function SpawnBody({ message }: { message: SpawnMessage }) {
  return (
    <div className="flex flex-col items-start gap-[8px] border-l-2 border-accent-line py-[2px] pl-[13px]">
      <Markdown>{message.text}</Markdown>
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

/* ---- formatting ------------------------------------------------------- */

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms < 1_000) return `${ms}ms`
  return `${(ms / 1_000).toFixed(1)}s`
}
