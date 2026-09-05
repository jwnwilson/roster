import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { rosterHome, setupStatePath } from './paths'

/**
 * The first-run marker, as it is written to `~/roster/setup.json`.
 *
 * Hand-editable like every other file Roster owns, so it is untrusted input:
 * every field is validated on the way in and a field of the wrong shape is
 * dropped rather than trusted.
 */
export interface SetupRecord {
  /** Schema version, so a later shape can be told apart from this one. */
  version: number
  /** When first-run setup ran. */
  seededAt: number
  /** Agents created by the seed, in the order they were created. */
  seededAgentIds: string[]
  /** The one recommended as a starting point — the Tech Lead. */
  startingAgentId: string | null
  /** When the user put the setup card away, or null while it still shows. */
  dismissedAt: number | null
}

export const SETUP_VERSION = 1

/**
 * Reads the marker, or null when there is none.
 *
 * A file that cannot be parsed still counts as a marker: it was written by a
 * previous run, and treating a corrupt one as "never set up" would seed a
 * second roster on top of the user's own.
 */
export async function readSetupRecord(): Promise<SetupRecord | null> {
  let raw: string
  try {
    raw = await readFile(setupStatePath(), 'utf8')
  } catch (cause) {
    if (isMissingFile(cause)) return null
    throw cause
  }

  return parseSetupRecord(raw)
}

/** Exported for the same reason agentToml's parser is: it is the boundary. */
export function parseSetupRecord(raw: string): SetupRecord {
  let table: unknown
  try {
    table = JSON.parse(raw)
  } catch {
    return emptyRecord()
  }

  if (typeof table !== 'object' || table === null || Array.isArray(table)) return emptyRecord()
  const fields = table as Record<string, unknown>

  return {
    version: numberOr(fields['version'], SETUP_VERSION),
    seededAt: numberOr(fields['seededAt'], 0),
    seededAgentIds: stringListOr(fields['seededAgentIds']),
    startingAgentId: typeof fields['startingAgentId'] === 'string' ? fields['startingAgentId'] : null,
    dismissedAt: typeof fields['dismissedAt'] === 'number' ? fields['dismissedAt'] : null,
  }
}

export async function writeSetupRecord(record: SetupRecord): Promise<void> {
  await mkdir(rosterHome(), { recursive: true })
  await writeFile(setupStatePath(), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

/**
 * What an unreadable marker means: setup has happened, and nothing can be
 * said about what it produced.
 *
 * Dismissed, because a card offering a starting agent it cannot name is
 * worse than no card — and the file being there at all proves a previous run
 * already had this conversation.
 */
function emptyRecord(): SetupRecord {
  return {
    version: SETUP_VERSION,
    seededAt: 0,
    seededAgentIds: [],
    startingAgentId: null,
    dismissedAt: 0,
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringListOr(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function isMissingFile(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT'
}
