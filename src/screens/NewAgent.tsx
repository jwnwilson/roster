import { useEffect, useState } from 'react'
import type { ModelInfo } from '@shared/types'
import {
  ChipField,
  ModelPicker,
  NameField,
  ProviderPicker,
  SystemPromptField,
  WorkingDirectory,
} from '@/components/AgentFields'
import { useRoster } from '@/state/store'
import { messageFor } from '@/lib/errors'

/**
 * Create-agent form. Reuses the Edit modal's fields, per the handoff, and
 * writes a real agent.toml on submit.
 */
export function NewAgent() {
  const go = useRoster((s) => s.go)
  const runners = useRoster((s) => s.runners)
  const skills = useRoster((s) => s.skills)
  const picked = useRoster((s) => s.picked)
  const togglePicked = useRoster((s) => s.togglePicked)
  const newRunner = useRoster((s) => s.newRunner)
  const setNewRunner = useRoster((s) => s.setNewRunner)
  const newModel = useRoster((s) => s.newModel)
  const setNewModel = useRoster((s) => s.setNewModel)
  const newPrompt = useRoster((s) => s.newPrompt)
  const setNewPrompt = useRoster((s) => s.setNewPrompt)

  const [name, setName] = useState('')
  const [cwd, setCwd] = useState<string | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.roster.runners.models(newRunner).then((loaded) => {
      if (cancelled) return
      setModels(loaded)
      // Default to the provider's first model so the form is submittable.
      if (loaded[0] && !loaded.some((m) => m.id === newModel)) setNewModel(loaded[0].id)
    })
    return () => {
      cancelled = true
    }
  }, [newRunner, newModel, setNewModel])

  const canCreate = name.trim() !== '' && newModel !== '' && !creating

  async function create(): Promise<void> {
    setCreating(true)
    setError(null)

    try {
      await window.roster.agents.create({
        name: name.trim(),
        runner: newRunner,
        model: newModel,
        systemPrompt: newPrompt,
        skills: Object.entries(picked)
          .filter(([, on]) => on)
          .map(([skill]) => skill),
        // Omitted means the default workspace, which the main process fills in.
        ...(cwd !== null ? { cwd } : {}),
      })
      go('grid')
    } catch (cause) {
      setError(messageFor(cause))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex h-screen justify-center overflow-y-auto px-[24px] pt-[56px] pb-[80px]">
      <div className="flex w-full max-w-[560px] flex-col gap-[28px]">
        <header className="flex flex-col gap-[10px]">
          <h1 className="m-0 text-title font-semibold tracking-[-0.02em]">Roster</h1>
          <p className="m-0 max-w-[460px] text-3xl leading-[1.6] text-muted">
            Manage your agent roster: create agents, give them skills and MCP servers, then
            hand them work.
          </p>
        </header>

        <div className="h-[1px] bg-line" />

        <NameField value={name} onChange={setName} />

        <SystemPromptField value={newPrompt} onChange={setNewPrompt} />

        <ProviderPicker runners={runners} value={newRunner} onChange={setNewRunner} />

        <ModelPicker models={models} value={newModel} onChange={setNewModel} />

        <WorkingDirectory
          value={cwd ?? '~/roster/workspace'}
          {...(cwd !== null ? { current: cwd } : {})}
          onChange={setCwd}
        />

        <ChipField
          label="Skills"
          names={skills.map((s) => s.name)}
          enabled={picked}
          onToggle={togglePicked}
          emptyText="No skills in the library yet."
        />

        {error ? <p className="m-0 text-md text-error">{error}</p> : null}

        <div className="flex items-center gap-[10px] pt-[4px]">
          <button
            type="button"
            onClick={() => go('grid')}
            className="cursor-pointer border-0 bg-transparent p-0 font-ui text-lg text-dim hover:text-ink"
            data-hoverable
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!canCreate}
            className="ml-auto cursor-pointer rounded-pill border-0 bg-accent px-[16px] py-[8px] font-ui text-lg font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
