import { useEffect, useState } from 'react'
import {
  PERMISSION_COPY,
  PERMISSION_KINDS,
  type PermissionKind,
  type PermissionReport,
  type PermissionStatus,
} from '@shared/permissions'
import { messageFor } from '@/lib/errors'
import { useRoster } from '@/state/store'

const WORDS: Record<PermissionStatus, string> = {
  granted: 'Allowed',
  denied: 'Not allowed',
  'not-determined': 'Not asked yet',
  restricted: 'Restricted by this Mac',
  unknown: 'Could not check',
  'not-applicable': 'Not applicable',
}

/**
 * The Roster-owned shell gate for the session's agent. It is not a macOS
 * permission, so it is not in PERMISSION_KINDS and nothing is granted in
 * System Settings: the row only reports the agent's setting and opens its
 * editor.
 */
export interface ShellRow {
  agentName: string
  runner: string
  allowShell: boolean
  autoApprove: boolean
  onEdit: () => void
}

/**
 * Shown once, above the first session's composer, so the permissions a
 * session needs are asked for before it runs rather than discovered when it
 * fails. Each row says what the permission is for, and offers to allow it or
 * to open the right System Settings pane.
 *
 * It goes away for good on Done, or as soon as Screen Recording is allowed,
 * since that is the one a session cannot do without.
 */
export function PermissionsCard({ shell }: { shell?: ShellRow }) {
  const setup = useRoster((s) => s.setup)
  const pending = setup !== null && !setup.permissionsReviewed
  const [report, setReport] = useState<PermissionReport | null>(null)
  const [busy, setBusy] = useState<PermissionKind | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!pending) return
    let cancelled = false
    window.roster.permissions
      .status()
      .then((next) => {
        if (!cancelled) setReport(next)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageFor(cause))
      })
    return () => {
      cancelled = true
    }
  }, [pending])

  const screenGranted = report?.screen === 'granted'
  useEffect(() => {
    if (pending && screenGranted) void review()
    // review is stable for this card's lifetime; the trigger is the grant itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, screenGranted])

  if (!pending) return null

  async function review(): Promise<void> {
    try {
      useRoster.setState({ setup: await window.roster.setup.reviewPermissions() })
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  async function allow(kind: PermissionKind): Promise<void> {
    setBusy(kind)
    setError(null)
    try {
      setReport(await window.roster.permissions.request(kind))
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setBusy(null)
    }
  }

  async function openSettings(kind: PermissionKind): Promise<void> {
    setError(null)
    try {
      await window.roster.permissions.openSettings(kind)
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  const button =
    'cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-muted hover:border-line-hover disabled:opacity-50'
  const primary =
    'cursor-pointer rounded-chip border-0 bg-accent px-[11px] py-[5px] font-ui text-md font-semibold text-white hover:bg-accent-hover disabled:opacity-50'

  return (
    <section
      aria-label="Permissions"
      className="mx-[26px] mb-[10px] flex flex-col gap-[10px] rounded-card border border-accent-line bg-card px-[16px] py-[14px]"
    >
      <h2 className="m-0 text-xl font-semibold tracking-[-0.01em]">Before this session runs</h2>
      <p className="m-0 text-md leading-[1.55] text-muted">
        Roster and its sessions use a few macOS privacy permissions. Allow what you need here. Each
        one can be changed later in System Settings.
      </p>

      <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
        {PERMISSION_KINDS.map((kind) => {
          const copy = PERMISSION_COPY[kind]
          const status = report?.[kind] ?? null
          return (
            <li key={kind} className="flex items-start justify-between gap-[12px]">
              <div className="flex min-w-0 flex-col gap-[2px]">
                <span className="text-md font-semibold text-ink">
                  {copy.label}
                  {copy.required ? null : <span className="font-normal text-dim"> · optional</span>}
                </span>
                <span className="text-md leading-[1.5] text-muted">{copy.purpose}</span>
              </div>
              <div className="flex flex-none items-center gap-[8px]">
                <span className="text-md text-dim-2">{status === null ? 'Checking…' : WORDS[status]}</span>
                {status === 'not-determined' ? (
                  <button
                    type="button"
                    aria-label={`Allow ${copy.label}`}
                    disabled={busy !== null}
                    onClick={() => void allow(kind)}
                    className={primary}
                  >
                    Allow
                  </button>
                ) : null}
                {status === 'denied' || status === 'restricted' || status === 'unknown' ? (
                  <button
                    type="button"
                    aria-label={`Open ${copy.label} settings`}
                    onClick={() => void openSettings(kind)}
                    className={button}
                  >
                    System Settings
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      {shell ? <ShellCommandsRow shell={shell} /> : null}

      {report !== null && report.screen !== 'granted' ? (
        <p className="m-0 text-md text-muted">
          Restart Roster after granting Screen Recording before a session can use it.
        </p>
      ) : null}
      {error ? <p role="alert" className="m-0 text-md text-error">{error}</p> : null}

      <div className="flex justify-end">
        <button type="button" onClick={() => void review()} className={primary}>
          Done
        </button>
      </div>
    </section>
  )
}

function ShellCommandsRow({ shell }: { shell: ShellRow }) {
  const allowed = shell.autoApprove || shell.allowShell
  const isClaude = shell.runner === 'claude'
  return (
    <div className="flex items-start justify-between gap-[12px] border-t border-line pt-[10px]">
      <div className="flex min-w-0 flex-col gap-[2px]">
        <span className="text-md font-semibold text-ink">Shell commands</span>
        <span className="text-md leading-[1.5] text-muted">
          {isClaude
            ? `Lets ${shell.agentName} run shell commands without the approval banner. Other tools still ask.`
            : 'Codex runs shell commands inside its own sandbox, so this setting does not apply.'}
        </span>
      </div>
      {isClaude ? (
        <div className="flex flex-none items-center gap-[8px]">
          <span className="text-md text-dim-2">{allowed ? 'Allowed' : 'Asks first'}</span>
          <button
            type="button"
            aria-label={`Change shell commands for ${shell.agentName}`}
            onClick={shell.onEdit}
            className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-muted hover:border-line-hover"
          >
            Change
          </button>
        </div>
      ) : null}
    </div>
  )
}
