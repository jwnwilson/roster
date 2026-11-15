import { useState, type FormEvent } from 'react'
import type { Customisation } from '@shared/types'
import { ScreenHeader, SectionLabel, TextInput } from '@/components/primitives'
import { useRoster } from '@/state/store'

/**
 * Customise: make a separate, changeable copy of Roster.
 *
 * The warning is always on screen above the form, because it is the consent.
 * Nothing is created until the box is ticked, and the main process repeats
 * that check, so this screen is a courtesy rather than the gate.
 */
export function Customise() {
  const copies = useRoster((s) => s.customisations)
  const setCustomisations = useRoster((s) => s.setCustomisations)
  const [managing, setManaging] = useState<string | null>(null)

  const managed = copies.find((copy) => copy.id === managing) ?? null

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ScreenHeader title="Customise" />

      <div className="flex max-w-[720px] flex-col gap-[18px] p-[20px]">
        {managed ? (
          <ManageCopy copy={managed} onBack={() => setManaging(null)} />
        ) : (
          <>
            <Warning />
            <NewCopyForm
              onCreated={(copy) => {
                setCustomisations(upsert(copies, copy))
                setManaging(copy.id)
              }}
            />
            <CopyList copies={copies} onManage={setManaging} />
          </>
        )}
      </div>
    </div>
  )
}

function Warning() {
  return (
    <section
      role="note"
      aria-label="Before you create a copy"
      className="flex flex-col gap-[8px] rounded-field border border-amber-line bg-amber-surface p-[14px] text-md text-ink"
    >
      <h2 className="m-0 text-xl font-semibold">Before you create a copy</h2>
      <ul className="m-0 flex list-disc flex-col gap-[5px] pl-[18px] text-muted">
        <li>This creates a separate copy of Roster that you can change. It is not the official app.</li>
        <li>
          Your copy will not receive updates from official releases. Updates are disabled for it, and that
          cannot be undone for that copy. You can pull changes from upstream only through Sync from upstream,
          which you start yourself.
        </li>
        <li>You are responsible for maintaining your changes. Roster does not support modified copies.</li>
        <li>
          Agents can change the main process and the runners, so a broken change can stop the copy from
          starting. The official app is not affected.
        </li>
      </ul>
    </section>
  )
}

function NewCopyForm({ onCreated }: { onCreated: (copy: Customisation) => void }) {
  const [name, setName] = useState('')
  const [forkUrl, setForkUrl] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canCreate = name.trim() !== '' && acknowledged && !busy

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!canCreate) return
    setBusy(true)
    setError(null)
    try {
      const copy = await window.roster.customisations.create({
        name,
        forkUrl: forkUrl.trim() === '' ? null : forkUrl,
        acknowledged: true,
      })
      setName('')
      setForkUrl('')
      setAcknowledged(false)
      onCreated(copy)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-[10px]">
      <SectionLabel>New copy</SectionLabel>
      <label className="flex flex-col gap-[4px] text-md text-muted">
        Copy name
        <TextInput value={name} onChange={setName} ariaLabel="Copy name" placeholder="for example, Fork" />
      </label>
      <label className="flex flex-col gap-[4px] text-md text-muted">
        Fork URL (optional)
        <TextInput
          value={forkUrl}
          onChange={setForkUrl}
          ariaLabel="Fork URL (optional)"
          placeholder="https://github.com/you/roster.git"
        />
        <span className="text-sm text-faint">
          The repository your changes are published to. You can add one later.
        </span>
      </label>
      <label className="flex items-start gap-[8px] text-md text-ink">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-[3px]"
        />
        <span>I understand the warning above, and that this copy is my responsibility.</span>
      </label>
      {error ? (
        <p role="alert" className="m-0 text-md text-error">
          {error}
        </p>
      ) : null}
      <div>
        <button
          type="submit"
          disabled={!canCreate}
          className="cursor-pointer rounded-chip border-0 bg-accent px-[11px] py-[5px] font-ui text-md font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
        >
          Create copy
        </button>
      </div>
    </form>
  )
}

function CopyList({ copies, onManage }: { copies: Customisation[]; onManage: (id: string) => void }) {
  if (copies.length === 0) {
    return (
      <section className="flex flex-col gap-[6px]">
        <SectionLabel>Your copies</SectionLabel>
        <p className="m-0 text-md text-faint">No copies yet.</p>
      </section>
    )
  }
  return (
    <section className="flex flex-col gap-[6px]">
      <SectionLabel>Your copies</SectionLabel>
      <ul aria-label="Your copies" className="m-0 flex list-none flex-col gap-[6px] p-0">
        {copies.map((copy) => (
          <li
            key={copy.id}
            className="flex items-center gap-[12px] rounded-field border border-line bg-card px-[12px] py-[10px]"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-md font-medium text-ink">{copy.name}</span>
              <span className="text-sm text-muted">
                {statusLabel(copy)} · port {copy.devPort} · {copy.forkRemote ?? 'No fork yet'}
              </span>
            </div>
            <button
              type="button"
              aria-label={`Manage ${copy.name}`}
              onClick={() => onManage(copy.id)}
              className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-muted hover:border-line-hover"
            >
              Manage
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ManageCopy({ copy, onBack }: { copy: Customisation; onBack: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const setCustomisations = useRoster((s) => s.setCustomisations)
  const copies = useRoster((s) => s.customisations)

  async function retry(): Promise<void> {
    setError(null)
    try {
      setCustomisations(upsert(copies, await window.roster.customisations.retry(copy.id)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <section className="flex flex-col gap-[12px]">
      <button
        type="button"
        onClick={onBack}
        className="w-fit cursor-pointer border-0 bg-transparent p-0 font-ui text-md text-muted hover:text-ink"
      >
        Back to copies
      </button>
      <h2 className="m-0 text-xl font-semibold text-ink">{copy.name}</h2>
      <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-[16px] gap-y-[6px] text-md">
        <dt className="text-faint">Status</dt>
        <dd className="m-0 text-ink">{statusLabel(copy)}</dd>
        <dt className="text-faint">Location</dt>
        <dd className="m-0 font-mono text-ink">{copy.pathLabel}</dd>
        <dt className="text-faint">Dev port</dt>
        <dd className="m-0 text-ink">{copy.devPort}</dd>
        <dt className="text-faint">Fork</dt>
        <dd className="m-0 text-ink">{copy.forkRemote ?? 'No fork yet'}</dd>
        <dt className="text-faint">Cloned from</dt>
        <dd className="m-0 font-mono text-ink">{copy.baseSha ? copy.baseSha.slice(0, 7) : '—'}</dd>
      </dl>

      {copy.status === 'provisioning' && copy.progress ? (
        <p className="m-0 text-md text-muted">{copy.progress}</p>
      ) : null}
      {copy.status === 'failed' && copy.error ? (
        <p role="alert" className="m-0 whitespace-pre-wrap font-mono text-sm text-error">
          {copy.error}
        </p>
      ) : null}
      {copy.status === 'failed' ? (
        <div>
          <button
            type="button"
            onClick={() => void retry()}
            className="cursor-pointer rounded-chip border-0 bg-accent px-[11px] py-[5px] font-ui text-md font-semibold text-white hover:bg-accent-hover"
          >
            Retry setup
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 text-md text-error">
          {error}
        </p>
      ) : null}

      <p className="m-0 text-md text-faint">
        Run controls, the agent session, publishing and sync arrive in later releases.
      </p>
    </section>
  )
}

function statusLabel(copy: Customisation): string {
  if (copy.status === 'provisioning') return 'Setting up…'
  if (copy.status === 'failed') return 'Setup failed'
  return 'Ready'
}

function upsert(copies: Customisation[], copy: Customisation): Customisation[] {
  return copies.some((c) => c.id === copy.id)
    ? copies.map((c) => (c.id === copy.id ? copy : c))
    : [...copies, copy]
}
