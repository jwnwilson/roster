import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import type { TaskStatus } from '@shared/types'
import type { ImportSummary, NotionConnection, NotionInspection, NotionMapping } from '@shared/notion'
import { taskStatusLabel } from '@shared/tasks'
import { Field, Modal, Select, TextInput } from '@/components/primitives'
import { messageFor } from '@/lib/errors'
import { activeProjects, useRoster } from '@/state/store'

const NO_PROJECT = 'none'
const UNMAPPED = 'none'

/**
 * Connecting the board to a Notion database, and pulling it in.
 *
 * One modal for the whole flow, because it is one decision: which database,
 * how its properties line up with ours, and where the tasks should land. The
 * mapping is shown rather than assumed — a Notion database is whatever
 * somebody made it, and a wrong guess would import every row into the wrong
 * column silently.
 */
export function NotionModal() {
  const close = () => useRoster.getState().setNotionOpen(false)
  // Importing into an archived project would file the pages somewhere
  // the board does not show, so only active ones are offered.
  const projects = useRoster(useShallow(activeProjects))

  const [connections, setConnections] = useState<NotionConnection[]>([])
  const [databaseInput, setDatabaseInput] = useState('')
  const [found, setFound] = useState<NotionInspection | null>(null)
  const [mapping, setMapping] = useState<NotionMapping | null>(null)
  const [project, setProject] = useState<string>(NO_PROJECT)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [busy, setBusy] = useState<'' | 'looking' | 'importing'>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.roster.notion
      .connections()
      .then(setConnections)
      .catch((cause: unknown) => setError(messageFor(cause)))
  }, [])

  const connected = connections[0] ?? null

  async function inspect(): Promise<void> {
    setBusy('looking')
    setError(null)
    setSummary(null)

    try {
      const inspection = await window.roster.notion.inspect(databaseInput)
      setFound(inspection)
      setMapping(inspection.mapping)
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setBusy('')
    }
  }

  async function connectAndImport(): Promise<void> {
    if (!found || !mapping) return
    setBusy('importing')
    setError(null)

    try {
      const connection = await window.roster.notion.connect({
        name: found.name,
        databaseId: found.databaseId,
        dataSourceId: found.dataSourceId,
        mapping,
        projectId: project === NO_PROJECT ? null : project,
      })
      setSummary(await window.roster.notion.importNow(connection.id))
      setConnections(await window.roster.notion.connections())
      // The board is stale the moment an import lands.
      useRoster.getState().setTasks(await window.roster.tasks.list())
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setBusy('')
    }
  }

  async function refresh(id: string): Promise<void> {
    setBusy('importing')
    setError(null)

    try {
      setSummary(await window.roster.notion.importNow(id))
      useRoster.getState().setTasks(await window.roster.tasks.list())
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setBusy('')
    }
  }

  async function disconnect(id: string): Promise<void> {
    setError(null)

    try {
      await window.roster.notion.disconnect(id)
      setConnections(await window.roster.notion.connections())
      setFound(null)
      setSummary(null)
    } catch (cause) {
      setError(messageFor(cause))
    }
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
            Roster pushes changes back on its own. Pulling is this button.
          </span>
          <button
            type="button"
            onClick={close}
            className="ml-auto cursor-pointer rounded-pill border border-line-card bg-transparent px-[13px] py-[7px] font-ui text-lg text-ink-3 hover:border-line-hover-strong"
            data-hoverable
          >
            Close
          </button>
          {found && !connected ? (
            <button
              type="button"
              disabled={busy !== ''}
              onClick={() => void connectAndImport()}
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
          <Connected
            connection={connected}
            busy={busy === 'importing'}
            onRefresh={() => void refresh(connected.id)}
            onDisconnect={() => void disconnect(connected.id)}
          />
        ) : (
          <Field
            label="Notion database"
            caption="Paste the database link, or its id. The integration needs access to it — open the database in Notion and use ••• → Connect to."
          >
            <div className="flex gap-[8px]">
              <TextInput
                ariaLabel="Notion database"
                placeholder="https://notion.so/…"
                value={databaseInput}
                onChange={setDatabaseInput}
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                disabled={busy !== '' || databaseInput.trim() === ''}
                onClick={() => void inspect()}
                className="flex-none cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-ink-3 hover:border-line-hover disabled:cursor-default disabled:opacity-40"
                data-hoverable
              >
                {busy === 'looking' ? 'Looking…' : 'Look up'}
              </button>
            </div>
          </Field>
        )}

        {found && mapping && !connected ? (
          <>
            <Mapping found={found} mapping={mapping} onChange={setMapping} />

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
          </>
        ) : null}

        {summary ? <Summary summary={summary} /> : null}
        {error ? <p className="m-0 text-md text-error">{error}</p> : null}
      </div>
    </Modal>
  )
}

function Connected({
  connection,
  busy,
  onRefresh,
  onDisconnect,
}: {
  connection: NotionConnection
  busy: boolean
  onRefresh: () => void
  onDisconnect: () => void
}) {
  return (
    <Field label="Connected to" caption="Changes on the board are written back to these pages.">
      <div className="flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-md text-ink">{connection.name}</span>
        <button
          type="button"
          disabled={busy}
          onClick={onRefresh}
          className="flex-none cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-ink-3 hover:border-line-hover disabled:cursor-default disabled:opacity-40"
          data-hoverable
        >
          {busy ? 'Importing…' : 'Import now'}
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          className="flex-none cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-dim hover:border-line-hover hover:text-error"
          data-hoverable
        >
          Disconnect
        </button>
      </div>
    </Field>
  )
}

/**
 * The detected mapping, shown so it can be corrected.
 *
 * Every board column gets a row, so a column nothing imports into is visible
 * rather than something you discover after importing three hundred rows.
 */
function Mapping({
  found,
  mapping,
  onChange,
}: {
  found: NotionInspection
  mapping: NotionMapping
  onChange: (mapping: NotionMapping) => void
}) {
  const options = (types: readonly string[]) => [
    { value: UNMAPPED, label: 'Not mapped' },
    ...found.properties
      .filter((property) => types.includes(property.type))
      .map((property) => ({ value: property.name, label: `${property.name} (${property.type})` })),
  ]

  const set = (patch: Partial<NotionMapping>) => onChange({ ...mapping, ...patch })
  const pick = (value: string) => (value === UNMAPPED ? null : value)

  return (
    <Field label={`Fields in "${found.name}"`} caption="Roster guessed these. Change any that are wrong.">
      <div className="flex flex-col gap-[8px]">
        <Row label="Title">
          <Select
            ariaLabel="Title property"
            value={mapping.title ?? UNMAPPED}
            onChange={(value) => set({ title: pick(value) })}
            options={options(['title', 'rich_text'])}
          />
        </Row>
        <Row label="Status">
          <Select
            ariaLabel="Status property"
            value={mapping.status ?? UNMAPPED}
            onChange={(value) => set({ status: pick(value) })}
            options={options(['status', 'select'])}
          />
        </Row>
        <Row label="Priority">
          <Select
            ariaLabel="Priority property"
            value={mapping.priority ?? UNMAPPED}
            onChange={(value) => set({ priority: pick(value) })}
            options={options(['select', 'status'])}
          />
        </Row>
        <Row label="Assignee">
          <Select
            ariaLabel="Assignee property"
            value={mapping.assignee ?? UNMAPPED}
            onChange={(value) => set({ assignee: pick(value) })}
            options={options(['people', 'select'])}
          />
        </Row>
      </div>

      {found.unmapped.length > 0 ? (
        <p className="m-0 text-sm text-amber-text">
          Nothing in Notion maps onto{' '}
          {found.unmapped.map((status: TaskStatus) => taskStatusLabel(status)).join(', ')}. Work in
          a column Roster does not recognise imports into the backlog.
        </p>
      ) : null}

      {mapping.title === null ? (
        <p className="m-0 text-sm text-error">
          Without a title there is nothing to put on a card, and every page will be skipped.
        </p>
      ) : null}
    </Field>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[10px]">
      <span className="w-[68px] flex-none text-md text-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function Summary({ summary }: { summary: ImportSummary }) {
  const parts = [
    `${summary.created} created`,
    `${summary.updated} updated`,
    ...(summary.skipped > 0 ? [`${summary.skipped} skipped`] : []),
  ]

  return (
    <div className="flex flex-col gap-[6px]">
      <p className="m-0 text-md text-ink">{parts.join(' · ')}.</p>
      {summary.failed.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-[3px] p-0">
          {summary.failed.map((failure) => (
            <li key={failure} className="text-sm text-error">
              {failure}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
