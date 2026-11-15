import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Customisation } from '../../../shared/types'
import type { CustomisationStore } from '../store/customisations'
import { branchNameFor, validateForkUrl, validateName } from './slug'
import { provisionCustomisation, type ProvisionDeps, type ProvisionInput, type ProvisionResult } from './provision'
import { nextStatus } from './state'
import { systemProvisionDeps } from './systemDeps'

export interface NewCopyInput {
  name: string
  forkUrl?: string | null
  /** Must be true. The warning has to be read and the box ticked first. */
  acknowledged: boolean
}

export interface CustomiseServiceOptions {
  store: CustomisationStore
  /** The folder copies are created in. */
  root: string
  /** The Roster repository to clone main from. */
  sourceUrl: string
  /** Picks a dev port the copies do not already hold. */
  pickPort: (taken: number[]) => Promise<number>
  onChanged: (copies: Customisation[]) => void
  provision?: (input: ProvisionInput, deps: ProvisionDeps) => Promise<ProvisionResult>
  systemDeps?: (onStep: (step: string) => void) => ProvisionDeps
  newId?: () => string
  now?: () => number
}

/**
 * Creates customised copies and provisions them in the background.
 *
 * The consent gate is here, not only in the screen: create refuses without
 * acknowledged, so no caller can clone, install or write anything for a copy
 * the user has not agreed to.
 */
export class CustomiseService {
  private readonly progress = new Map<string, string>()
  private readonly provision: (input: ProvisionInput, deps: ProvisionDeps) => Promise<ProvisionResult>
  private readonly systemDeps: (onStep: (step: string) => void) => ProvisionDeps

  constructor(private readonly options: CustomiseServiceOptions) {
    this.provision = options.provision ?? provisionCustomisation
    this.systemDeps = options.systemDeps ?? systemProvisionDeps
  }

  list(): Customisation[] {
    return this.options.store.list().map((copy) => ({
      ...copy,
      progress: this.progress.get(copy.id) ?? null,
    }))
  }

  async create(input: NewCopyInput): Promise<Customisation> {
    if (input.acknowledged !== true) {
      throw new Error('Acknowledge the warning before a copy is created.')
    }
    const name = validateName(input.name)
    const forkUrl = validateForkUrl(input.forkUrl)
    // Refuse a name with no usable slug before anything is written to disk.
    branchNameFor(name)

    const id = (this.options.newId ?? randomUUID)()
    const path = join(this.options.root, id)
    const devPort = await this.options.pickPort(this.options.store.usedPorts())
    const now = (this.options.now ?? Date.now)()

    this.options.store.insert({
      id,
      name,
      path,
      forkRemote: forkUrl,
      baseSha: null,
      rosterHome: join(path, 'home'),
      devPort,
      acknowledgedAt: now,
      createdAt: now,
    })
    void this.run(id)
    this.changed()
    return this.view(id)
  }

  /** Runs a failed provision again. Each step is idempotent, so this resumes it. */
  async retry(id: string): Promise<Customisation> {
    const current = this.require(id)
    nextStatus(current.status, 'start')
    this.options.store.setStatus(id, 'provisioning')
    void this.run(id)
    this.changed()
    return this.view(id)
  }

  private async run(id: string): Promise<void> {
    const copy = this.require(id)
    const onStep = (step: string): void => {
      this.progress.set(id, step)
      this.changed()
    }
    try {
      const result = await this.provision(
        {
          path: copy.path,
          homeDir: copy.rosterHome,
          sourceUrl: this.options.sourceUrl,
          forkUrl: copy.forkRemote,
          branch: branchNameFor(copy.name),
          acknowledgedAt: copy.acknowledgedAt,
        },
        this.systemDeps(onStep),
      )
      this.progress.delete(id)
      this.options.store.setStatus(id, nextStatus('provisioning', 'succeed'), {
        baseSha: copy.baseSha ?? result.baseSha,
      })
    } catch (cause) {
      this.progress.delete(id)
      this.options.store.setStatus(id, nextStatus('provisioning', 'fail'), {
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
    this.changed()
  }

  private require(id: string): Customisation {
    const copy = this.options.store.findById(id)
    if (!copy) throw new Error(`unknown customised copy "${id}"`)
    return copy
  }

  private view(id: string): Customisation {
    const copy = this.list().find((c) => c.id === id)
    if (!copy) throw new Error(`unknown customised copy "${id}"`)
    return copy
  }

  private changed(): void {
    this.options.onChanged(this.list())
  }
}
