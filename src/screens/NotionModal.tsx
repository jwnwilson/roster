import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { TASK_STATUSES, type TaskStatus } from '@shared/types'
import type { NotionAuthStatus, NotionStatusMap } from '@shared/notion'
import { taskStatusLabel } from '@shared/tasks'
import { Field, Modal, Select, TextInput } from '@/components/primitives'
import { messageFor } from '@/lib/errors'
import { activeProjects, useRoster } from '@/state/store'

const NO_PROJECT = 'none'

/**
 * Putting a Notion task on the board, and saying what its statuses are called.
 *
 * One page at a time, by its link: a Notion database is whatever somebody
 * made it, and importing every row of one turned out to be far more machinery
 * than the thing people actually do — which is paste the task they are about
 * to work on.
 *
 * The status map is the only configuration left. Roster has five columns and
 * a Notion board usually has three, so the names cannot be guessed reliably;
 * they are shown, with sensible defaults, and the user corrects them.
 */
export function NotionModal() {
  const close = () => useRoster.getState().setNotionOpen(false)
  // Filing a page under an archived project would put it where the board does
  // not show it, so only active ones are offered.
  const projects = useRoster(useShallow(activeProjects))

  const [auth, setAuth] = useState<NotionAuthStatus | null>(null)
  const [url, setUrl] = useState('')
  const [project, setProject] = useState<string>(NO_PROJECT)
  const [statusMap, setStatusMap] = useState<NotionStatusMap | null>(null)
  const [imported, setImported] = useState<{ taskId: string; created: boolean } | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState<'' | 'importing' | 'authorizing' | 'saving'>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([window.roster.notion.authStatus(), window.roster.notion.statusMap()])
      .then(([nextAuth, nextMap]) => {
        setAuth(nextAuth)
        setStatusMap(nextMap)
      })
      .catch((cause: unknown) => setError(messageFor(cause)))
  }, [])

  const connected = auth?.state === 'connected'
  // A sign-in that failed is remembered by the main process, so the reason is
  // shown on opening rather than only to whoever was watching at the time.
  const shown = error ?? (auth?.state === 'error' ? auth.message : null)

  async function beginAuth(): Promise<void> {
    setBusy('authorizing')
    setError(null)
    try {
      await window.roster.notion.beginAuth()
      // The browser returns to a loopback listener in the main process. Polling
      // is intentional: it avoids exposing OAuth codes or tokens to the renderer.
      const poll = async (): Promise<void> => {
        const next = await window.roster.notion.authStatus()
        setAuth(next)
        if (next.state === 'disconnected') window.setTimeout(() => void poll(), 750)
        else {
          setBusy('')
          if (next.state === 'error') setError(next.message)
        }
      }
      void poll()
    } catch (cause) {
      setBusy('')
      setError(messageFor(cause))
    }
  }

  async function importTask(): Promise<void> {
    setBusy('importing')
    setError(null)
    setImported(null)

    try {
      const result = await window.roster.notion.importTask({
        url,
        projectId: project === NO_PROJECT ? null : project,
      })
      setImported({ taskId: result.task.id, created: result.created })
      setUrl('')
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setBusy('')
    }
  }

  async function saveStatusMap(): Promise<void> {
    if (!statusMap) return
    setBusy('saving')
    setError(null)

    try {
      setStatusMap(await window.roster.notion.saveStatusMap(statusMap))
      setSaved(true)
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setBusy('')
    }
  }

  async function disconnect(): Promise<void> {
    setError(null)
    try {
      await window.roster.notion.clearAuth()
      setAuth(await window.roster.notion.authStatus())
    } catch (cause) {
      setError(messageFor(cause))
    }
  }

  function openImported(taskId: string): void {
    useRoster.getState().openTask(taskId)
    close()
  }

  return (
    <Modal
      label="Notion"
      onClose={close}
      maxWidth={560}
      header={<h2 className="m-0 text-2xl font-semibold">Notion</h2>}
      footer={
        <>
          <span className="text-sm text-faint">
            Status moves and comments on an imported task are written to its Notion page.
          </span>
          <button
            type="button"
            onClick={close}
            className="ml-auto cursor-pointer rounded-pill border border-line-card bg-transparent px-[13px] py-[7px] font-ui text-lg text-ink-3 hover:border-line-hover-strong"
            data-hoverable
          >
            Close
          </button>
          {connected ? (
            <button
              type="button"
              disabled={busy !== '' || url.trim() === ''}
              onClick={() => void importTask()}
              className="cursor-pointer rounded-pill border-0 bg-accent px-[15px] py-[7px] font-ui text-lg font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
            >
              {busy === 'importing' ? 'Importing…' : 'Import'}
            </button>
          ) : null}
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto p-[18px]">
        {connected ? (
          <>
            <Field
              label="Notion task"
              caption="Paste the link to a Notion page. Roster needs access to it — open the page in Notion and use ••• → Connect to."
            >
              <TextInput
                ariaLabel="Notion task"
                placeholder="https://notion.so/…"
                value={url}
                onChange={setUrl}
              />
            </Field>

            <Field label="Import into" caption="Imported tasks are filed under this project.">
              <Select
                ariaLabel="Import into"
                value={project}
                onChange={setProject}
                options={[
                  { value: NO_PROJECT, label: 'No project' },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </Field>

            {imported ? (
              <button
                type="button"
                onClick={() => openImported(imported.taskId)}
                className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[7px] text-left font-ui text-md text-ink-3 hover:border-line-hover"
                data-hoverable
              >
                {imported.created
                  ? `Added ${imported.taskId}`
                  : `Already on the board as ${imported.taskId}`}
              </button>
            ) : null}

            {statusMap ? (
              <StatusMap
                map={statusMap}
                busy={busy === 'saving'}
                saved={saved}
                onChange={(next) => {
                  setStatusMap(next)
                  setSaved(false)
                }}
                onSave={() => void saveStatusMap()}
              />
            ) : null}

            <div>
              <button
                type="button"
                onClick={() => void disconnect()}
                className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-dim hover:border-line-hover"
                data-hoverable
              >
                Disconnect Notion
              </button>
            </div>
          </>
        ) : (
          <Field
            label="Connect Notion"
            caption={
              auth?.state === 'needs_configuration'
                ? auth.message
                : 'Authorize Roster to read the Notion workspace in your browser.'
            }
          >
            <button
              type="button"
              disabled={busy !== '' || auth?.state === 'needs_configuration'}
              onClick={() => void beginAuth()}
              className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-ink-3 hover:border-line-hover disabled:cursor-default disabled:opacity-40"
              data-hoverable
            >
              {busy === 'authorizing' ? 'Waiting for Notion…' : 'Connect Notion'}
            </button>
          </Field>
        )}

        {shown ? <p className="m-0 text-md text-error">{shown}</p> : null}
      </div>
    </Modal>
  )
}

interface StatusMapProps {
  map: NotionStatusMap
  busy: boolean
  saved: boolean
  onChange: (map: NotionStatusMap) => void
  onSave: () => void
}

/**
 * What each Roster column is called in Notion.
 *
 * Free text rather than a picker: the names belong to whichever database the
 * page lives in, and Roster does not read a schema any more. Two columns may
 * share a name, which is how a five-column board fits a three-column one.
 */
function StatusMap({ map, busy, saved, onChange, onSave }: StatusMapProps) {
  return (
    <Field
      label="Status names in Notion"
      caption="Moving a card writes the matching name to its Notion page. Leave two columns sharing a name if Notion has fewer."
    >
      <div className="flex flex-col gap-[8px]">
        {TASK_STATUSES.map((status: TaskStatus) => (
          <div key={status} className="flex items-center gap-[8px]">
            <span className="w-[96px] flex-none text-md text-dim">{taskStatusLabel(status)}</span>
            <TextInput
              ariaLabel={`${taskStatusLabel(status)} in Notion`}
              value={map[status]}
              onChange={(value) => onChange({ ...map, [status]: value })}
              className="min-w-0 flex-1"
            />
          </div>
        ))}
        <div className="flex items-center gap-[8px]">
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-ink-3 hover:border-line-hover disabled:cursor-default disabled:opacity-40"
            data-hoverable
          >
            {busy ? 'Saving…' : 'Save status names'}
          </button>
          {saved ? <span className="text-sm text-faint">Saved</span> : null}
        </div>
      </div>
    </Field>
  )
}
