import type { RunnerStatus, SetupState } from '../../../shared/types'
import type { AgentStore } from './agents'
import { defaultAgentsFor } from './defaultAgents'
import {
  readSetupRecord,
  writeSetupRecord,
  SETUP_VERSION,
  type SetupRecord,
} from './setupState'

/**
 * First-run setup: seed a small starter roster, once, and tell the renderer
 * whether the setup card is still worth showing.
 *
 * Three rules shape this:
 *  - It runs once ever. The marker file decides, not an empty agents
 *    directory — deleting every agent is a decision, not an invitation.
 *  - An install that already has agents is never seeded over, and never
 *    opens onto a setup card. Upgrading must change nothing.
 *  - Nothing is seeded against a CLI that is not installed, because the row
 *    it produces could not run.
 */
export async function prepareFirstRun(
  agents: AgentStore,
  runners: Map<string, RunnerStatus>,
): Promise<SetupState> {
  const record = await readSetupRecord()
  if (record) return stateFrom(record, agents)

  // An established roster that predates the marker. Claim first run so it is
  // never seeded over, and say nothing to the user about it.
  if (agents.findAll().length > 0) {
    const now = Date.now()
    await writeSetupRecord({
      version: SETUP_VERSION,
      seededAt: now,
      seededAgentIds: [],
      startingAgentId: null,
      dismissedAt: now,
    })
    return { pending: false, startingAgentId: null, seededAgentIds: [], noRunner: false }
  }

  const defaults = defaultAgentsFor(runners)
  if (defaults.length === 0) {
    // Deliberately no marker: installing a CLI and reopening Roster should
    // still get the starter roster. The card explains what is missing.
    return { pending: true, startingAgentId: null, seededAgentIds: [], noRunner: true }
  }

  // Claimed before anything is created, so a failure halfway through leaves a
  // partial roster rather than a duplicated one on the next launch.
  const claim: SetupRecord = {
    version: SETUP_VERSION,
    seededAt: Date.now(),
    seededAgentIds: [],
    startingAgentId: null,
    dismissedAt: null,
  }
  await writeSetupRecord(claim)

  const seeded: string[] = []
  for (const input of defaults) {
    const agent = await agents.create(input)
    seeded.push(agent.id)
  }

  // The first default agent is the Tech Lead, by construction.
  const startingAgentId = seeded[0] ?? null
  await writeSetupRecord({ ...claim, seededAgentIds: seeded, startingAgentId })

  return { pending: true, startingAgentId, seededAgentIds: seeded, noRunner: false }
}

/** Puts the setup card away for good. Idempotent, and safe with no marker. */
export async function dismissSetup(): Promise<SetupState> {
  const record = await readSetupRecord()
  const now = Date.now()

  const next: SetupRecord = record
    ? { ...record, dismissedAt: record.dismissedAt ?? now }
    : {
        version: SETUP_VERSION,
        seededAt: now,
        seededAgentIds: [],
        startingAgentId: null,
        dismissedAt: now,
      }

  await writeSetupRecord(next)

  return {
    pending: false,
    startingAgentId: next.startingAgentId,
    seededAgentIds: next.seededAgentIds,
    noRunner: false,
  }
}

/**
 * A recommendation is only worth making while the agent is still there, so
 * the starting agent is resolved against the live roster every time.
 */
function stateFrom(record: SetupRecord, agents: AgentStore): SetupState {
  const starting =
    record.startingAgentId !== null && agents.findById(record.startingAgentId) !== null
      ? record.startingAgentId
      : null

  return {
    pending: record.dismissedAt === null,
    startingAgentId: starting,
    seededAgentIds: record.seededAgentIds,
    noRunner: false,
  }
}
