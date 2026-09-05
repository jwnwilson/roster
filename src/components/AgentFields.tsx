import { MAX_AGENT_NAME_LENGTH } from '@shared/agentName'
import type { ModelInfo, RunnerStatus } from '@shared/types'
import { Field, ToggleChip } from './primitives'

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
    <Field label="Provider">
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
}

export function ModelPicker({ models, value, onChange }: ModelPickerProps) {
  return (
    <Field label="Model">
      <div className="flex flex-col gap-[6px]">
        {models.length === 0 ? (
          <p className="m-0 text-md text-dim">No models available for this provider.</p>
        ) : (
          models.map((model) => {
            const on = model.id === value
            return (
              <button
                key={model.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(model.id)}
                className={`flex cursor-pointer items-center gap-[10px] rounded-field border px-[12px] py-[9px] ${
                  on ? 'border-accent bg-accent-surface' : 'border-line-card bg-card'
                } hover:border-line-hover-strong`}
                data-hoverable
              >
                <span
                  aria-hidden
                  className="flex h-[12px] w-[12px] flex-none items-center justify-center rounded-full border"
                  style={{
                    borderColor: on ? 'var(--color-accent)' : 'var(--color-line-hover-strong)',
                  }}
                >
                  <span
                    className="h-[6px] w-[6px] rounded-full"
                    style={{ background: on ? 'var(--color-accent)' : 'transparent' }}
                  />
                </span>
                <span className="font-mono text-lg text-ink-2">{model.id}</span>
                <span className="ml-auto font-mono text-sm text-dim-2">{model.price}</span>
              </button>
            )
          })
        )}
      </div>
    </Field>
  )
}

interface WorkingDirectoryProps {
  value: string
  /** Absolute path the picker opens at; falls back to the value shown. */
  current?: string
  onChange?: (path: string) => void
}

export function WorkingDirectory({ value, current, onChange }: WorkingDirectoryProps) {
  async function choose(): Promise<void> {
    const picked = await window.roster.dialog.chooseDirectory(current ?? value)
    // Cancelling leaves the directory untouched.
    if (picked !== null) onChange?.(picked)
  }

  return (
    <Field label="Working directory">
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
