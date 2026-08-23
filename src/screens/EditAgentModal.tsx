import { useEffect, useState } from 'react'
import type { Agent, ModelInfo } from '@shared/types'
import {
  ChipField,
  ModelPicker,
  ProviderPicker,
  SystemPromptField,
  WorkingDirectory,
} from '@/components/AgentFields'
import { Field } from '@/components/primitives'
import { useRoster } from '@/state/store'

interface EditAgentModalProps {
  agent: Agent
}

/**
 * Edits are staged in a draft and only written to agent.toml on Save;
 * Cancel discards them. The draft itself lives in the store so the
 * semantics are testable without rendering.
 */
export function EditAgentModal({ agent }: EditAgentModalProps) {
  const draft = useRoster((s) => s.draft)
  const patchDraft = useRoster((s) => s.patchDraft)
  const toggleDraftSkill = useRoster((s) => s.toggleDraftSkill)
  const toggleDraftMcp = useRoster((s) => s.toggleDraftMcp)
  const cancelEdit = useRoster((s) => s.cancelEdit)
  const setAgents = useRoster((s) => s.setAgents)
  const runners = useRoster((s) => s.runners)
  const skills = useRoster((s) => s.skills)
  const mcpServers = useRoster((s) => s.mcpServers)
  const go = useRoster((s) => s.go)

  const [models, setModels] = useState<ModelInfo[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runnerId = draft?.runner ?? agent.runner

  // The model list is scoped to the chosen provider, per the handoff.
  useEffect(() => {
    let cancelled = false
    void window.roster.runners.models(runnerId).then((loaded) => {
      if (!cancelled) setModels(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [runnerId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancelEdit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelEdit])

  if (!draft) return null

  async function save(): Promise<void> {
    if (!draft) return
    setSaving(true)
    setError(null)

    try {
      await window.roster.agents.update(agent.id, {
        runner: draft.runner,
        model: draft.model,
        systemPrompt: draft.systemPrompt,
        skills: Object.entries(draft.skills)
          .filter(([, on]) => on)
          .map(([name]) => name),
        mcpServers: Object.entries(draft.mcp)
          .filter(([, on]) => on)
          .map(([name]) => name),
      })
      // Re-read rather than patching locally, so the UI reflects the file.
      setAgents(await window.roster.agents.list())
      cancelEdit()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${agent.name}`}
      className="fixed inset-0 z-40 flex items-center justify-center px-[24px] py-[40px]"
      style={{ background: 'rgba(6,7,10,0.66)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) cancelEdit()
      }}
    >
      <div className="flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-modal border border-line-card bg-app shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
        <header className="flex flex-none items-center gap-[10px] border-b border-line px-[18px] py-[13px]">
          <h2 className="m-0 text-2xl font-semibold">Edit {agent.name}</h2>
          <span className="truncate font-mono text-sm text-dim-2">agent.toml</span>
          <button
            type="button"
            aria-label="Close"
            onClick={cancelEdit}
            className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-ui text-[15px] leading-none text-dim hover:text-ink"
            data-hoverable
          >
            ×
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto p-[18px]">
          <Field label="Name">
            <span className="rounded-field border border-line-card bg-card px-[12px] py-[9px] text-xl text-ink">
              {agent.name}
            </span>
          </Field>

          <SystemPromptField
            value={draft.systemPrompt}
            onChange={(systemPrompt) => patchDraft({ systemPrompt })}
          />

          <ProviderPicker
            runners={runners}
            value={draft.runner}
            onChange={(runner) => patchDraft({ runner, model: '' })}
          />

          <ModelPicker
            models={models}
            value={draft.model}
            onChange={(model) => patchDraft({ model })}
          />

          <WorkingDirectory value={agent.cwdLabel} />

          <ChipField
            label="Skills"
            names={skills.map((s) => s.name)}
            enabled={draft.skills}
            onToggle={toggleDraftSkill}
            emptyText="No skills in the library yet."
          />

          <ChipField
            label="MCP servers"
            names={mcpServers.map((s) => s.name)}
            enabled={draft.mcp}
            onToggle={toggleDraftMcp}
            emptyText="No MCP servers configured."
            mono
            dotShape="circle"
            trailing={
              <button
                type="button"
                onClick={() => {
                  cancelEdit()
                  go('mcp')
                }}
                className="cursor-pointer border-0 bg-transparent p-0 font-ui text-sm text-accent-light"
              >
                Manage servers
              </button>
            }
          />

          {error ? <p className="m-0 text-md text-error">{error}</p> : null}
        </div>

        <footer className="flex flex-none items-center gap-[10px] border-t border-line bg-sunken px-[18px] py-[13px]">
          <span className="text-sm text-faint">Changes are written back to agent.toml</span>
          <button
            type="button"
            onClick={cancelEdit}
            className="ml-auto cursor-pointer rounded-pill border border-line-card bg-transparent px-[13px] py-[7px] font-ui text-lg text-ink-3 hover:border-line-hover-strong"
            data-hoverable
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || draft.model === ''}
            className="cursor-pointer rounded-pill border-0 bg-accent px-[15px] py-[7px] font-ui text-lg font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}
