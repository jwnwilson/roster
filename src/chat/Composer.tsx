import { ComposerPrimitive, unstable_useComposerInput } from '@assistant-ui/react'
import { useEffect, useRef, useState } from 'react'
import { messageFor } from '@/lib/errors'
import type { VoiceModelProgress } from '@shared/voice'
import { BrowserVoiceCapture, MAX_VOICE_SECONDS } from './voice/audio'
import { VoiceWorkerClient } from './voice/workerClient'

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
  sessionId: string
  agentName: string
  skillsLine: string
  disabled: boolean
  planMode: boolean
  onTogglePlanMode: () => void
}

export function Composer({
  sessionId,
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
          <VoiceInput key={sessionId} disabled={disabled} />
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
  const [state, setState] = useState<'idle' | 'starting' | 'needs-model' | 'downloading' | 'recording' | 'transcribing'>('idle')
  const stateRef = useRef(state)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const generation = useRef(0)
  const draft = useRef(composer.value)
  const capture = useRef<BrowserVoiceCapture | null>(null)
  const worker = useRef<VoiceWorkerClient | null>(null)
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    draft.current = composer.value
  }, [composer.value])

  function transition(next: typeof state): void {
    stateRef.current = next
    setState(next)
  }

  useEffect(
    () => {
      const unsubscribe = window.roster.voice.onModelProgress((progress) => {
        if (stateRef.current === 'downloading') setStatus(downloadStatus(progress))
      })
      return () => {
        unsubscribe()
        generation.current++
        clearRecordingTimer()
        capture.current?.cancel()
        worker.current?.cancel()
        if (stateRef.current === 'downloading') {
          void window.roster.voice.cancelModelDownload().catch(() => undefined)
        }
      }
    }, [],
  )

  useEffect(() => {
    if (state === 'idle' || state === 'needs-model') return
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void cancel()
    }
    window.addEventListener('keydown', cancelOnEscape)
    return () => window.removeEventListener('keydown', cancelOnEscape)
  })

  async function start(): Promise<void> {
    if (composer.isDisabled || stateRef.current !== 'idle') return
    const operation = ++generation.current
    transition('starting')
    setError(null)
    setStatus(null)

    try {
      const capability = await window.roster.voice.status()
      if (operation !== generation.current) return
      if (!capability.available || capability.engine === 'off') {
        throw new Error(capability.reason ?? 'Voice input is unavailable.')
      }
      if (capability.model?.state !== 'ready') {
        transition('needs-model')
        setStatus('Voice runs locally and audio is not uploaded. Download the English model from Hugging Face before recording.')
        return
      }
      const nextCapture = new BrowserVoiceCapture()
      capture.current = nextCapture
      await nextCapture.start()
      if (operation !== generation.current) {
        nextCapture.cancel()
        return
      }
      transition('recording')
      setStatus('Recording. Press Stop when finished; recording stops automatically after 60 seconds.')
      recordingTimer.current = setTimeout(() => {
        setStatus('Maximum recording length reached. Transcribing…')
        void stop()
      }, MAX_VOICE_SECONDS * 1_000)
    } catch (cause) {
      if (operation !== generation.current) return
      capture.current?.cancel()
      capture.current = null
      transition('idle')
      setError(messageFor(cause) || 'Roster could not start voice dictation.')
    }
  }

  async function stop(): Promise<void> {
    if (stateRef.current !== 'recording') return
    clearRecordingTimer()
    const operation = generation.current
    const activeCapture = capture.current!
    transition('transcribing')
    setStatus('Transcribing locally…')
    try {
      const audio = await activeCapture.stop()
      if (operation !== generation.current) return
      capture.current = null
      worker.current ??= new VoiceWorkerClient()
      const text = await worker.current.transcribe(audio)
      if (operation === generation.current && text !== '') {
        composer.setText(draft.current === '' ? text : `${draft.current}\n${text}`)
      }
    } catch (cause) {
      if (operation === generation.current) setError(messageFor(cause))
    } finally {
      if (operation === generation.current) {
        activeCapture.cancel()
        capture.current = null
        transition('idle')
        setStatus(null)
      }
    }
  }

  async function downloadModel(): Promise<void> {
    if (stateRef.current !== 'needs-model') return
    const operation = ++generation.current
    setError(null)
    transition('downloading')
    setStatus('Downloading local voice model…')
    try {
      await window.roster.voice.downloadModel()
      if (operation !== generation.current) return
      transition('idle')
      setStatus('Local voice model is ready. Activate Voice again to record.')
    } catch (cause) {
      if (operation !== generation.current) return
      transition('needs-model')
      setError(messageFor(cause))
      setStatus(null)
    }
  }

  async function cancel(): Promise<void> {
    const previous = stateRef.current
    generation.current++
    clearRecordingTimer()
    capture.current?.cancel()
    worker.current?.cancel()
    capture.current = null
    transition(previous === 'downloading' ? 'needs-model' : 'idle')
    setStatus(previous === 'downloading' ? 'Voice model download cancelled.' : 'Voice input cancelled.')
    if (previous === 'downloading') await window.roster.voice.cancelModelDownload().catch(() => undefined)
  }

  function clearRecordingTimer(): void {
    if (recordingTimer.current) clearTimeout(recordingTimer.current)
    recordingTimer.current = null
  }

  return (
    <div className="flex items-center gap-[6px]">
      <button
        type="button"
        aria-label={state === 'recording' ? 'Stop recording voice message' : state === 'starting' ? 'Cancel voice recording' : state === 'transcribing' ? 'Cancel voice transcription' : 'Record voice message'}
        aria-pressed={state === 'recording'}
        disabled={composer.isDisabled || state === 'downloading' || state === 'needs-model'}
        onClick={() => void (state === 'recording' ? stop() : state === 'transcribing' || state === 'starting' ? cancel() : start())}
        className={`flex-none cursor-pointer rounded-chip border px-[10px] py-[4px] font-ui text-md disabled:cursor-default disabled:opacity-40 ${
          state === 'recording'
            ? 'border-error bg-error/10 text-error'
            : 'border-line-input bg-transparent text-muted-2 hover:border-line-hover'
        }`}
        data-hoverable
      >
        {state === 'recording' ? 'Stop' : state === 'transcribing' || state === 'starting' ? 'Cancel' : 'Voice'}
      </button>
      {state === 'needs-model' ? (
        <button
          type="button"
          onClick={() => void downloadModel()}
          className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[10px] py-[4px] font-ui text-md text-muted-2 hover:border-line-hover"
        >
          Download local model (~45 MB)
        </button>
      ) : null}
      {state === 'downloading' ? (
        <button type="button" onClick={() => void cancel()} className="cursor-pointer font-ui text-sm text-muted-2 underline">
          Cancel download
        </button>
      ) : null}
      {status ? <span role="status" aria-live="polite" className="max-w-[300px] text-sm text-dim">{status}</span> : null}
      {error ? <span role="alert" className="max-w-[260px] text-sm text-error">{error}</span> : null}
    </div>
  )
}

function downloadStatus(progress: VoiceModelProgress): string {
  const percent = progress.bytesTotal === 0
    ? 0
    : Math.min(100, Math.round(progress.bytesDownloaded / progress.bytesTotal * 100))
  return `Downloading local voice model… ${percent}%`
}
