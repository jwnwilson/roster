/**
 * Validating an agent's display name.
 *
 * A name is what a person calls an agent — it is not an identifier. The id is,
 * and it never moves: sessions, tasks, plans, `@mentions` and the agent's own
 * directory all point at it, so renaming touches the label alone and
 * everything stays attributed.
 *
 * Names are still held apart from one another, case-insensitively, because a
 * roster with two "Review Agent"s is ambiguous everywhere a person reads one —
 * the assignee picker, the sidebar, the Notion assignee mapping.
 *
 * One place does read the name as meaning rather than as a label: Notion
 * import matches a person to an agent by name (`agentIdFor` in
 * electron/main/notion/sync.ts). Renaming an agent therefore changes which
 * Notion people land on it, which is the point — the name is what says the
 * two are the same one. Uniqueness is what makes that match deterministic.
 */

/** Long enough for a sentence-ish name, short enough to fit a sidebar row. */
export const MAX_AGENT_NAME_LENGTH = 60

export interface NamedAgent {
  id: string
  name: string
}

/**
 * Trims and checks a name coming in from the UI or from IPC. Throws with a
 * message written for the person who typed it.
 */
export function normalizeAgentName(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('an agent name must be text')

  const name = raw.trim()
  if (name === '') throw new Error('an agent needs a name')
  if (name.length > MAX_AGENT_NAME_LENGTH) {
    throw new Error(`an agent name can be at most ${MAX_AGENT_NAME_LENGTH} characters`)
  }
  return name
}

/**
 * Rejects a name another agent already answers to. `exceptId` is the agent
 * being renamed, so recasing its own name is not a clash with itself.
 */
export function assertNameIsFree(
  name: string,
  existing: Iterable<NamedAgent>,
  exceptId: string | null = null,
): void {
  const wanted = name.toLowerCase()

  for (const agent of existing) {
    if (agent.id === exceptId) continue
    if (agent.name.toLowerCase() !== wanted) continue
    throw new Error(`there is already an agent named "${agent.name}"`)
  }
}
