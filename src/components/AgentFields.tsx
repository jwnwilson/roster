import { MAX_AGENT_NAME_LENGTH } from '@shared/agentName'
import { useState } from 'react'
import { FEATURED_PROVIDERS, type ModelInfo, type Project, type RunnerStatus } from '@shared/types'
import { projectOptionLabel } from '@/state/store'
import { Field, Select, ToggleChip } from './primitives'

/** The picker's stand-in for "no project", since a select has no null. */
export const NO_DEFAULT_PROJECT = 'none'

/* -------------------------------------------------------------------------
 * The fields shared by the Edit modal and the New Agent form. The handoff
 * specifies both as the same controls, so they are written once.
 * ---------------------------------------------------------------------- */

interface NameFieldProps {
  value: string
  onChange: (value: string) => void
}

/**
 * The agent's display name, on both the New Agent form and the Edit modal.
 *
 * Editable in both because a name is a label: renaming an agent leaves its id,
 * its directory and everything pointing at it exactly where they were.
 */
export function NameField({ value, onChange }: NameFieldProps) {
  return (
    <Field label="Name">
      <input
        type="text"
        value={value}
        aria-label="Agent name"
        placeholder="Architect Agent"
        maxLength={MAX_AGENT_NAME_LENGTH}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-field border border-line-card bg-card px-[12px] py-[9px] font-ui text-xl text-ink outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2"
      />
    </Field>
  )
}

interface ProviderPickerProps {
  runners: RunnerStatus[]
  value: string
  onChange: (runnerId: string) => void
}

/**
 * Three cards named by provider, per the approved variant B: the runner is
 * inferred rather than named. A provider whose CLI is unusable is still
 * selectable — the agent then shows `error`, which is where the reason is
 * surfaced.
 */
export function ProviderPicker({ runners, value, onChange }: ProviderPickerProps) {
  return (
    <Field label="Harness">
      <div className="grid grid-cols-3 gap-[9px]">
        {runners.map((runner) => {
          const on = runner.id === value
          return (
            <button
              key={runner.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(runner.id)}
              className={`flex cursor-pointer flex-col gap-[3px] rounded-field border px-[11px] py-[10px] text-left ${
                on ? 'border-accent bg-accent-surface' : 'border-line-card bg-card'
              } hover:border-line-hover-strong`}
              data-hoverable
            >
              <span
                className={`text-lg font-semibold ${on ? 'text-ink' : 'text-muted'}`}
              >
                {runner.provider}
              </span>
              <span className="truncate font-mono text-sm text-dim">
                {describeAuth(runner)}
              </span>
            </button>
          )
        })}
      </div>
    </Field>
  )
}

/** With CLI runners there is no key to mask, so this reports usability. */
function describeAuth(runner: RunnerStatus): string {
  if (!runner.installed) return 'not installed'
  if (runner.auth === 'subscription') return 'subscription'
  if (runner.auth === 'api-key') return 'api key'
  return 'not signed in'
}

interface ModelPickerProps {
  models: ModelInfo[]
  value: string
  onChange: (modelId: string) => void
  /** Receives the list again after a check marks what the account can use. */
  onModelsChanged?: (models: ModelInfo[]) => void
}

/** Where a model with no `provider/` prefix is listed. */
const NO_PROVIDER = 'other'

/** The provider part of `provider/id`. */
function providerOf(modelId: string): string {
  const slash = modelId.indexOf('/')
  return slash === -1 ? NO_PROVIDER : modelId.slice(0, slash)
}

/** A model's id without its provider, which the Provider dropdown already says. */
function bareId(modelId: string): string {
  const slash = modelId.indexOf('/')
  return slash === -1 ? modelId : modelId.slice(slash + 1)
}

export interface ProviderOption {
  id: string
  /** Display name, e.g. "OpenAI Codex"; the id when Pi gives none. */
  name: string
  /** True when any of its models is usable without signing in first. */
  signedIn: boolean
}

/**
 * Every provider the model list mentions, once each. The featured ones come
 * first in their own order, then whatever else is signed in, then the rest
 * alphabetically — Pi knows dozens of providers and most go unused.
 */
export function providerOptions(models: ModelInfo[]): ProviderOption[] {
  const byId = new Map<string, ProviderOption>()
  for (const model of models) {
    const id = providerOf(model.id)
    const known = byId.get(id)
    const signedIn = model.signedIn !== false
    if (known) known.signedIn ||= signedIn
    else byId.set(id, { id, name: model.provider ?? (id === NO_PROVIDER ? 'Other' : id), signedIn })
  }
  const featured: readonly string[] = FEATURED_PROVIDERS
  const rank = (option: ProviderOption): number => {
    const at = featured.indexOf(option.id)
    if (at !== -1) return at
    return featured.length + (option.signedIn ? 0 : 1)
  }
  return [...byId.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** One provider's models, in the order Pi lists them. */
export function modelsFor(models: ModelInfo[], provider: string): ModelInfo[] {
  return models.filter((model) => providerOf(model.id) === provider)
}

function modelLabel(model: ModelInfo): string {
  const parts = [bareId(model.id)]
  if (model.price !== '') parts.push(model.price)
  if (model.unavailable !== undefined) parts.push('not on your plan')
  return parts.join(' · ')
}

const SELECT_CLASS =
  'w-full cursor-pointer appearance-none rounded-field border border-line-card bg-card px-[12px] py-[9px] font-ui text-lg text-ink-2 outline-none hover:border-line-hover-strong focus:border-accent-line'

/** Whether a provider matches what has been typed: its name or its id. */
function matchesProvider(option: ProviderOption, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return option.name.toLowerCase().includes(needle) || option.id.includes(needle)
}

/** The provider Roster refreshes the account's model list for as soon as it is picked. */
const AUTO_CHECK_PROVIDER = 'anthropic'

export function ModelPicker({ models, value, onChange, onModelsChanged }: ModelPickerProps) {
  const providers = providerOptions(models)
  // Follows the selected model, but is also its own choice: a provider whose
  // every model is refused can be looked at without a model being picked.
  const [chosen, setChosen] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // What is typed into the provider box while it is being searched. Null
  // while the box shows the chosen provider's name.
  const [typed, setTyped] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)

  const fromValue = value !== '' && models.some((model) => model.id === value) ? providerOf(value) : null
  const provider =
    chosen !== null && (fromValue === null || fromValue === chosen)
      ? chosen
      : (fromValue ?? providers.find((p) => p.signedIn)?.id ?? providers[0]?.id ?? '')
  const current = providers.find((p) => p.id === provider)
  const listed = modelsFor(models, provider)
  const matches = providers.filter((option) => matchesProvider(option, typed ?? ''))

  async function refresh(providerId: string): Promise<void> {
    if (!onModelsChanged) return
    setChecking(true)
    try {
      onModelsChanged(await window.roster.runners.checkModels('pi', providerId))
    } finally {
      setChecking(false)
    }
  }

  function pickProvider(next: string): void {
    setChosen(next)
    setTyped(null)
    const first = modelsFor(models, next).find((model) => model.unavailable === undefined)
    if (first) onChange(first.id)
    if (next === AUTO_CHECK_PROVIDER) void refresh(next)
  }

  function openList(query: string | null): void {
    setTyped(query)
    setHighlight(0)
  }

  if (models.length === 0) {
    return (
      <Field label="Model">
        <p className="m-0 text-md text-dim">No models available.</p>
      </Field>
    )
  }

  const open = typed !== null
  const listId = 'provider-options'

  return (
    <>
      <Field
        label="Provider"
        caption={
          checking && current
            ? `Checking which ${current.name} models your account can use…`
            : current && !current.signedIn
              ? `Not signed in to ${current.name} yet — the agent will ask to sign in when it first runs.`
              : undefined
        }
      >
        <div className="relative">
          <input
            type="text"
            role="combobox"
            aria-label="Provider"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            value={open ? typed : (current?.name ?? '')}
            placeholder="Type a provider, e.g. xai"
            onFocus={() => openList('')}
            onChange={(event) => openList(event.target.value)}
            onBlur={() => setTyped(null)}
            onKeyDown={(event) => {
              if (!open) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlight((at) => Math.min(at + 1, matches.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlight((at) => Math.max(at - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const picked = matches[highlight]
                if (picked) pickProvider(picked.id)
              } else if (event.key === 'Escape') {
                setTyped(null)
              }
            }}
            className={`${SELECT_CLASS} font-ui`}
            data-hoverable
          />
          {open ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Providers"
              className="absolute z-10 mt-[4px] max-h-[260px] w-full overflow-y-auto rounded-field border border-line-card bg-card p-[4px] shadow-lg"
            >
              {matches.length === 0 ? (
                <li className="px-[10px] py-[7px] text-md text-dim">No provider matches “{typed}”.</li>
              ) : (
                matches.map((option, at) => (
                  <li key={option.id} role="presentation">
                    {/* mouseDown, not click: the box blurs first, which would close the list. */}
                    <button
                      type="button"
                      role="option"
                      aria-selected={option.id === provider}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        pickProvider(option.id)
                      }}
                      onMouseEnter={() => setHighlight(at)}
                      className={`flex w-full cursor-pointer items-center gap-[8px] rounded-chip px-[10px] py-[7px] text-left font-ui text-lg ${
                        at === highlight ? 'bg-accent-surface' : ''
                      } ${option.signedIn ? 'text-ink-2' : 'text-dim'}`}
                    >
                      <span>{option.name}</span>
                      {option.signedIn ? null : (
                        <span className="ml-auto rounded-full border border-line-card px-[7px] py-[1px] text-xs text-dim">
                          sign in
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      </Field>

      <Field label="Model">
        <div className="relative">
          <select
            aria-label="Model"
            // Empty while the provider's every model is refused, so the
            // select does not claim one it is not set to.
            value={listed.some((model) => model.id === value) ? value : ''}
            onChange={(event) => onChange(event.target.value)}
            className={`${SELECT_CLASS} font-mono`}
            data-hoverable
          >
            {listed.some((model) => model.id === value) ? null : (
              <option value="" disabled>
                Choose a model
              </option>
            )}
            {listed.map((model) => (
              // Greyed out, not hidden: knowing a model exists but is not on
              // your plan is information. Picking it would only fail.
              <option
                key={model.id}
                value={model.id}
                disabled={model.unavailable !== undefined}
                title={model.unavailable}
              >
                {modelLabel(model)}
              </option>
            ))}
          </select>
          <Chevron />
        </div>
      </Field>
    </>
  )
}

function Chevron() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 right-[12px] -translate-y-1/2 text-sm text-dim"
    >
      ▾
    </span>
  )
}

interface WorkingDirectoryProps {
  value: string
  /** Absolute path the picker opens at; falls back to the value shown. */
  current?: string
  /** What the shown value means, when it is not a directory the user picked. */
  caption?: string
  onChange?: (path: string) => void
}

export function WorkingDirectory({ value, current, caption, onChange }: WorkingDirectoryProps) {
  async function choose(): Promise<void> {
    const picked = await window.roster.dialog.chooseDirectory(current ?? value)
    // Cancelling leaves the directory untouched.
    if (picked !== null) onChange?.(picked)
  }

  return (
    <Field label="Working directory" {...(caption !== undefined ? { caption } : {})}>
      <div className="flex gap-[9px]">
        <span className="flex-1 truncate rounded-field border border-line-card bg-card px-[12px] py-[9px] font-mono text-lg text-muted-2">
          {value}
        </span>
        <button
          type="button"
          onClick={() => void choose()}
          disabled={!onChange}
          className="cursor-pointer rounded-field border border-line-card bg-transparent px-[14px] py-[9px] font-ui text-lg text-ink-3 hover:border-line-hover-strong disabled:cursor-default disabled:opacity-50"
          data-hoverable
        >
          Choose…
        </button>
      </div>
    </Field>
  )
}

interface ChipFieldProps {
  label: string
  names: string[]
  enabled: Record<string, boolean>
  onToggle: (name: string) => void
  emptyText: string
  mono?: boolean
  dotShape?: 'square' | 'circle'
  trailing?: React.ReactNode
}

export function ChipField({
  label,
  names,
  enabled,
  onToggle,
  emptyText,
  mono = false,
  dotShape = 'square',
  trailing,
}: ChipFieldProps) {
  return (
    <Field label={label} trailing={trailing}>
      {names.length === 0 ? (
        <p className="m-0 text-md text-dim">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-[8px]">
          {names.map((name) => (
            <ToggleChip
              key={name}
              label={name}
              on={enabled[name] === true}
              onToggle={() => onToggle(name)}
              mono={mono}
              dotShape={dotShape}
            />
          ))}
        </div>
      )}
    </Field>
  )
}

interface DefaultProjectFieldProps {
  /** What the picker offers. An archived project the agent already names belongs here. */
  projects: Project[]
  value: string | null
  onChange: (projectId: string | null) => void
}

/**
 * The project this agent's new sessions are filed under.
 *
 * A session still gets its project from one place — someone saying so — but
 * an agent that only ever works on one piece of work should not need saying
 * so every time. Choosing "No project" clears the default again.
 *
 * With no projects to choose from the label stays and says so, the way an
 * empty skill or server list does. Removing the field was worse than useless:
 * it is indistinguishable from the setting not existing, and a fresh install
 * — no projects anywhere — is exactly where somebody goes looking for it.
 */
export function DefaultProjectField({ projects, value, onChange }: DefaultProjectFieldProps) {
  if (projects.length === 0) {
    return (
      <Field label="Default project">
        <p className="m-0 text-md text-dim">
          No projects yet — create one to file this agent&apos;s sessions under it.
        </p>
      </Field>
    )
  }

  return (
    <Field
      label="Default project"
      caption="New sessions on this agent are filed here unless another project is chosen."
    >
      <Select
        ariaLabel="Default project"
        value={value ?? NO_DEFAULT_PROJECT}
        onChange={(picked) => onChange(picked === NO_DEFAULT_PROJECT ? null : picked)}
        options={[
          { value: NO_DEFAULT_PROJECT, label: 'No project' },
          ...projects.map((project) => ({
            value: project.id,
            label: projectOptionLabel(project),
          })),
        ]}
      />
    </Field>
  )
}

interface SystemPromptFieldProps {
  value: string
  onChange: (value: string) => void
}

export function SystemPromptField({ value, onChange }: SystemPromptFieldProps) {
  return (
    <Field
      label="System prompt"
      trailing={
        <span className="font-mono text-sm text-faint-2">{value.length} characters</span>
      }
      caption="Prepended to every session on this agent, above its skills."
    >
      <textarea
        value={value}
        rows={6}
        aria-label="System prompt"
        placeholder="How this agent should work — house rules, what to do first, what never to do."
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-field border border-line-card bg-card px-[12px] py-[11px] font-ui text-lg leading-[1.6] text-ink-2 outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2"
      />
    </Field>
  )
}
