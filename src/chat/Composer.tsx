import { ComposerPrimitive, unstable_useComposerInput } from '@assistant-ui/react'
import { useEffect, useRef, useState } from 'react'
import { messageFor } from '@/lib/errors'

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
  planMode: boolean
  onTogglePlanMode: () => void
}

export function Composer({
  agentName,
  skillsLine,
  disabled,
  planMode,
  onTogglePlanMode,
}: ComposerProps) {
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
          <VoiceInput disabled={disabled} />
          <button
            type="button"
            aria-pressed={planMode}
            title="Research and propose a plan; make no edits this turn"
            onClick={onTogglePlanMode}
            className={`ml-auto flex flex-none cursor-pointer items-center gap-[6px] rounded-chip border px-[10px] py-[4px] font-ui text-md ${
              planMode
                ? 'border-accent-line bg-accent-surface text-accent-text'
                : 'border-line-input bg-transparent text-muted-2 hover:border-line-hover'
            }`}
            data-hoverable
          >
            <span
              aria-hidden
              className="h-[5px] w-[5px] rounded-full"
              style={{ background: planMode ? 'var(--color-accent)' : 'var(--color-off)' }}
            />
            Plan
          </button>
          <ComposerPrimitive.Send
            disabled={disabled}
            className="flex-none cursor-pointer rounded-chip border-0 bg-accent px-[12px] py-[4px] font-ui text-md font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
          >
            Send
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </div>
  )
}

/**
 * Records only while the person explicitly asks it to. The returned text is
 * put into assistant-ui's existing composer state, where it can be corrected
 * or discarded before Send creates a turn.
 */
function VoiceInput({ disabled }: { disabled: boolean }) {
  const composer = unstable_useComposerInput({ disabled })
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const discard = useRef(false)
  const draft = useRef(composer.value)

  useEffect(() => {
    draft.current = composer.value
  }, [composer.value])

  useEffect(
    () => () => {
      discard.current = true
      recorder.current?.stop()
      stream.current?.getTracks().forEach((track) => track.stop())
    }, [])

  function release(): void {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    recorder.current = null
  }

  async function start(): Promise<void> {
    if (composer.isDisabled || state !== 'idle') return
    setError(null)
    discard.current = false

    try {
      const captured = await navigator.mediaDevices.getUserMedia({ audio: true })
      // The request may settle after a component is disabled or unmounted.
      if (discard.current) {
        captured.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = captured
      const preferred = 'audio/webm;codecs=opus'
      const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : 'audio/webm'
      const next = new MediaRecorder(captured, { mimeType })
      const chunks: BlobPart[] = []
      next.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      })
      next.addEventListener('stop', () => {
        release()
        if (discard.current) return
        void transcribe(new Blob(chunks, { type: next.mimeType || mimeType }))
      })
      recorder.current = next
      next.start()
      setState('recording')
    } catch (cause) {
      release()
      setState('idle')
      setError(messageFor(cause) || 'Roster could not access the microphone.')
    }
  }

  function stop(): void {
    if (state !== 'recording') return
    setState('transcribing')
    recorder.current?.stop()
  }

  async function transcribe(audio: Blob): Promise<void> {
    try {
      const result = await window.roster.voice.transcribe({
        audio: await audio.arrayBuffer(),
        mimeType: audio.type,
      })
      if (result.text !== '') {
        composer.setText(draft.current === '' ? result.text : `${draft.current}\n${result.text}`)
      }
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setState('idle')
    }
  }

  return (
    <div className="flex items-center gap-[6px]">
      <button
        type="button"
        aria-label={state === 'recording' ? 'Stop recording voice message' : 'Record voice message'}
        aria-pressed={state === 'recording'}
        disabled={composer.isDisabled || state === 'transcribing'}
        onClick={() => void (state === 'recording' ? stop() : start())}
        className={`flex-none cursor-pointer rounded-chip border px-[10px] py-[4px] font-ui text-md disabled:cursor-default disabled:opacity-40 ${
          state === 'recording'
            ? 'border-error bg-error/10 text-error'
            : 'border-line-input bg-transparent text-muted-2 hover:border-line-hover'
        }`}
        data-hoverable
      >
        {state === 'recording' ? 'Stop' : state === 'transcribing' ? 'Transcribing…' : 'Voice'}
      </button>
      {error ? <span role="alert" className="max-w-[260px] text-sm text-error">{error}</span> : null}
    </div>
  )
}
