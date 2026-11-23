import { useEffect, useRef, useState } from 'react'
import type { ProviderSummary, SignInEvent, SignInMethod, SignInPrompt } from '@shared/types'
import { GhostButton, Modal, PrimaryButton } from '@/components/primitives'

/** The label Pi's text prompts offer in place of choices. */
const CANCEL = 'Cancel'

interface SignInModalProps {
  providers: ProviderSummary[]
  /** Starts the sign-in at once, rather than at the provider list. */
  initial?: { providerId: string; method: SignInMethod }
  onClose: () => void
  onSignedIn: (providerName: string) => void
}

type Stage = { kind: 'pick' } | { kind: 'running'; providerName: string } | { kind: 'failed'; message: string }

/**
 * Signs a model provider in without a conversation.
 *
 * Pick a provider and a way in, then the sign-in runs in the main process.
 * What Pi's login asks — a code to paste, an API key, a choice — arrives as a
 * prompt here, and the answer goes back the same way. Nothing is stored here:
 * the credentials are Pi's.
 */
export function SignInModal({ providers, initial, onClose, onSignedIn }: SignInModalProps) {
  const [stage, setStage] = useState<Stage>(initial ? { kind: 'running', providerName: '' } : { kind: 'pick' })
  const [providerId, setProviderId] = useState(initial?.providerId ?? groupProviders(providers)[0]?.items[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [method, setMethod] = useState<SignInMethod | null>(initial?.method ?? null)
  const [prompt, setPrompt] = useState<SignInPrompt | null>(null)
  const [notices, setNotices] = useState<string[]>([])
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const off = window.roster.signIn.onEvent((event: SignInEvent) => {
      if (!mounted.current) return
      if (event.type === 'prompt') setPrompt(event.prompt)
      else if (event.type === 'notice') setNotices((all) => [...all, event.text])
      else setPrompt((current) => (current?.id === event.id ? null : current))
    })
    return () => {
      mounted.current = false
      off()
    }
  }, [])

  const chosen = providers.find((p) => p.id === providerId)

  async function start(id: string, way: SignInMethod): Promise<void> {
    const name = providers.find((p) => p.id === id)?.name ?? id
    setStage({ kind: 'running', providerName: name })
    setNotices([])
    const result = await window.roster.signIn.start(id, way)
    if (!mounted.current) return
    setPrompt(null)
    if (result.ok) onSignedIn(name)
    else setStage({ kind: 'failed', message: result.message })
  }

  // Started straight away when opened for one provider. Once, on open: a
  // later render must not sign in again.
  useEffect(() => {
    if (initial) void start(initial.providerId, initial.method)
  }, [])

  function answer(approved: boolean, value?: string): void {
    if (!prompt) return
    const question = prompt.question.question
    void window.roster.signIn.answer(prompt.id, {
      approved,
      ...(approved && value !== undefined ? { answers: { [question]: value } } : {}),
    })
    setPrompt(null)
  }

  function chooseWay(provider: ProviderSummary): void {
    void start(provider.id, method ?? provider.methods[0]!.method)
  }

  function cancel(): void {
    if (stage.kind === 'running') void window.roster.signIn.cancel()
    onClose()
  }

  const header = (
    <h2 className="m-0 text-2xl font-semibold">
      {stage.kind === 'running' && stage.providerName ? `Sign in to ${stage.providerName}` : 'Sign in to a model provider'}
    </h2>
  )

  if (stage.kind === 'pick') {
    const visible = filterProviders(providers, query)
    const groups = groupProviders(visible)

    // Moves the selection onto a match when the search hides the one chosen,
    // so Continue (and Enter) always act on a provider the user can see.
    function search(next: string): void {
      setQuery(next)
      const shown = filterProviders(providers, next)
      if (shown.length > 0 && !shown.some((p) => p.id === providerId)) {
        setProviderId(shown[0]!.id)
        setMethod(null)
      }
    }

    return (
      <Modal label="Sign in to a model provider" onClose={onClose} maxWidth={560} header={header} footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => chosen && chooseWay(chosen)}>Continue</PrimaryButton>
        </>
      }>
        <form
          className="flex flex-col gap-[12px] px-[18px] py-[14px]"
          onSubmit={(e) => {
            e.preventDefault()
            if (chosen && visible.some((p) => p.id === chosen.id)) chooseWay(chosen)
          }}
        >
          <p className="m-0 text-md text-muted">
            Account sign-ins open your browser. An API key is typed here, and Pi keeps it.
          </p>
          <div className="flex items-center gap-[10px]">
            <input
              type="search"
              aria-label="Search model providers"
              placeholder="Search providers"
              value={query}
              onChange={(e) => search(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-chip border border-line-input bg-card px-[10px] py-[5px] text-md text-ink outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2"
            />
            <span aria-live="polite" className="flex-none whitespace-nowrap text-sm text-dim">
              {query.trim() === '' ? `${providers.length} providers` : `${visible.length} of ${providers.length} providers`}
            </span>
          </div>

          <div className="flex max-h-[360px] flex-col gap-[14px] overflow-y-auto pr-[4px]">
            {groups.map((group) => (
              <section key={group.title} className="flex flex-col gap-[6px]">
                <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.06em] text-dim">{group.title}</h3>
                <div role="radiogroup" aria-label={group.title} className="grid grid-cols-2 gap-[6px]">
                  {group.items.map((p) => (
                    <Choice
                      key={p.id}
                      selected={p.id === providerId}
                      onSelect={() => {
                        setProviderId(p.id)
                        setMethod(null)
                      }}
                      title={p.name}
                      detail={providerHint(p)}
                    />
                  ))}
                </div>
              </section>
            ))}
            {visible.length === 0 ? (
              <p className="m-0 text-md text-muted">No provider matches “{query.trim()}”.</p>
            ) : null}
          </div>

          {chosen && visible.some((p) => p.id === chosen.id) && chosen.methods.length > 1 && (
            <div role="radiogroup" aria-label="How to sign in" className="flex flex-col gap-[6px]">
              {chosen.methods.map((m) => (
                <Choice
                  key={m.method}
                  selected={(method ?? chosen.methods[0]!.method) === m.method}
                  onSelect={() => setMethod(m.method)}
                  title={m.label}
                  detail={m.description}
                />
              ))}
            </div>
          )}
        </form>
      </Modal>
    )
  }

  if (stage.kind === 'failed') {
    return (
      <Modal label="Sign-in failed" onClose={onClose} header={header} footer={
        <>
          <GhostButton onClick={onClose}>Close</GhostButton>
          <PrimaryButton onClick={() => setStage({ kind: 'pick' })}>Try again</PrimaryButton>
        </>
      }>
        <p role="alert" className="m-0 text-md text-error">{stage.message}</p>
      </Modal>
    )
  }

  return (
    <Modal label="Signing in" onClose={cancel} header={header} footer={
      <GhostButton onClick={cancel}>Cancel</GhostButton>
    }>
      {notices.map((text) => (
        <p key={text} className="m-0 break-all rounded-chip border border-line-card bg-sunken px-[10px] py-[6px] font-mono text-md text-ink-2">
          {text}
        </p>
      ))}
      {prompt ? (
        <PromptBody prompt={prompt} onAnswer={answer} />
      ) : (
        <p className="m-0 text-md text-muted">
          Waiting for {stage.providerName || 'the provider'}…
        </p>
      )}
    </Modal>
  )
}

/**
 * Pi's question. Refusing it is the footer's Cancel, which stops the sign-in
 * as a whole, so there is no second way to say no here.
 */
function PromptBody({ prompt, onAnswer }: { prompt: SignInPrompt; onAnswer: (approved: boolean, value?: string) => void }) {
  const { question } = prompt
  const isText = question.options.length === 1 && question.options[0]?.label === CANCEL
  const [typed, setTyped] = useState('')
  const [picked, setPicked] = useState(question.options[0]?.label ?? '')

  if (isText) {
    return (
      <form
        className="flex flex-col gap-[10px]"
        onSubmit={(e) => {
          e.preventDefault()
          if (typed.trim() !== '') onAnswer(true, typed.trim())
        }}
      >
        <label className="flex flex-col gap-[6px] text-md text-ink-2">
          {question.question}
          <input
            autoFocus
            type={prompt.secret ? 'password' : 'text'}
            aria-label={question.question}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="rounded-chip border border-accent-line bg-accent-surface-2 px-[10px] py-[6px] font-mono text-md text-ink outline-none"
          />
        </label>
        <div className="flex justify-end">
          <PrimaryButton onClick={() => typed.trim() !== '' && onAnswer(true, typed.trim())}>Continue</PrimaryButton>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-[10px]">
      <p className="m-0 text-md text-ink-2">{question.question}</p>
      <div role="radiogroup" aria-label={question.question} className="flex flex-col gap-[6px]">
        {question.options.map((option) => (
          <Choice
            key={option.label}
            selected={picked === option.label}
            onSelect={() => setPicked(option.label)}
            title={option.label}
            detail={option.description}
          />
        ))}
      </div>
      <div className="flex justify-end">
        <PrimaryButton onClick={() => onAnswer(true, picked)}>Continue</PrimaryButton>
      </div>
    </div>
  )
}

interface ProviderGroup {
  title: string
  items: ProviderSummary[]
}

/**
 * Signed-in providers first, then account sign-ins, then API keys. Each group
 * sorted by name; empty groups are dropped, so a search leaves only the
 * headings it needs.
 */
function groupProviders(list: readonly ProviderSummary[]): ProviderGroup[] {
  const byName = (a: ProviderSummary, b: ProviderSummary) => a.name.localeCompare(b.name)
  const signed = list.filter((p) => p.signedIn).sort(byName)
  const account = list.filter((p) => !p.signedIn && p.methods.some((m) => m.method === 'oauth')).sort(byName)
  const key = list.filter((p) => !p.signedIn && !p.methods.some((m) => m.method === 'oauth')).sort(byName)
  return [
    { title: 'Signed in', items: signed },
    { title: 'Account sign-in', items: account },
    { title: 'API key', items: key },
  ].filter((group) => group.items.length > 0)
}

/** Case-insensitive match on the provider's name or id. */
function filterProviders(list: readonly ProviderSummary[], query: string): ProviderSummary[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...list]
  return list.filter((p) => p.name.toLowerCase().includes(needle) || p.id.toLowerCase().includes(needle))
}

/** A short line for the tile: signed in, or the ways in. */
function providerHint(p: ProviderSummary): string {
  if (p.signedIn) return 'Signed in'
  return p.methods.map((m) => (m.method === 'oauth' ? 'Account' : 'API key')).join(' · ')
}

function Choice({
  selected,
  onSelect,
  title,
  detail,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  detail?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={title}
      onClick={onSelect}
      className={`flex cursor-pointer items-start gap-[10px] rounded-card border px-[12px] py-[9px] text-left font-ui ${
        selected ? 'border-accent bg-accent-surface' : 'border-line-card bg-transparent hover:border-line-hover'
      }`}
    >
      <span
        aria-hidden
        className={`mt-[3px] h-[13px] w-[13px] flex-none rounded-full border ${
          selected ? 'border-accent shadow-[inset_0_0_0_3px_var(--color-accent-surface)] bg-accent' : 'border-line-hover-strong'
        }`}
      />
      <span className="flex flex-col">
        <span className="text-lg font-medium text-ink">{title}</span>
        {detail ? <span className="text-sm text-dim">{detail}</span> : null}
      </span>
    </button>
  )
}
