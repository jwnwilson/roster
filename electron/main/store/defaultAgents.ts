import { join } from 'node:path'
import type { RunnerStatus } from '../../../shared/types'
import type { NewAgentInput } from './agents'
import { rosterHome } from './paths'

/**
 * The roster a brand-new install starts with.
 *
 * Three agents, not a directory of them: enough to show what a roster is for
 * — hand work to one, have it hand work on — while staying small enough to
 * read in one go and delete in three clicks.
 */

/** The recommended starting point, and always the first agent seeded. */
export const TECH_LEAD = 'Tech Lead'

/**
 * Runners a default agent may be pointed at.
 *
 * Narrower than BUILTIN_RUNNERS on purpose: `gemini` is detected, but Roster
 * has no adapter that can drive it, so an agent naming it could never take a
 * turn. Ordered by preference.
 */
const SEEDABLE_RUNNERS: readonly string[] = ['claude', 'codex']

/** The model each runner starts on. The user can change it in one click. */
const DEFAULT_MODEL: Record<string, string> = {
  claude: 'claude-sonnet-5',
  codex: 'gpt-5.6-terra',
}

interface DefaultAgent {
  name: string
  systemPrompt: string
  /** Names from the seeded skill library; missing ones are simply not used. */
  skills: string[]
}

const DEFAULTS: readonly DefaultAgent[] = [
  {
    name: TECH_LEAD,
    systemPrompt: [
      'You are the tech lead on this roster. Work starts with you.',
      '',
      'Understand the request before proposing anything, break it into pieces',
      'small enough to hand off, and say which piece you would do first and why.',
      'Record decisions worth remembering as an ADR. When a piece is better',
      'done by another agent on the roster, hand it to them and say what you',
      'expect back.',
    ].join('\n'),
    skills: ['adr-writer', 'estimate-breakdown'],
  },
  {
    name: 'Implementer',
    systemPrompt: [
      'You implement work the tech lead has scoped.',
      '',
      'Reproduce a bug with a failing test before you touch source. Make the',
      'smallest change that passes, then say what you did not do.',
    ].join('\n'),
    skills: ['repro-harness', 'stack-triage'],
  },
  {
    name: 'Reviewer',
    systemPrompt: [
      'You review changes before they land.',
      '',
      'Correctness first, style last. Separate blocking notes from nits, quote',
      'the line you are reacting to, and say so first when a change has no test.',
    ].join('\n'),
    skills: ['pr-review'],
  },
]

/**
 * The default agents, pointed at a runner that is actually on this machine.
 *
 * Empty when nothing usable is installed — a seeded agent whose CLI does not
 * exist is a broken row on the grid, which is worse than an empty one.
 */
export function defaultAgentsFor(runners: Map<string, RunnerStatus>): NewAgentInput[] {
  const runner = chooseRunner(runners)
  if (runner === null) return []

  const model = DEFAULT_MODEL[runner] ?? ''
  const cwd = join(rosterHome(), 'workspace')

  return DEFAULTS.map((agent) => ({
    name: agent.name,
    runner,
    model,
    cwd,
    systemPrompt: agent.systemPrompt,
    skills: [...agent.skills],
    mcpServers: [],
  }))
}

/**
 * Signed in beats merely installed, and preference order breaks the tie.
 *
 * An installed-but-logged-out runner is still worth seeding against: the
 * agent shows why it cannot run and one `claude auth login` fixes every row.
 */
function chooseRunner(runners: Map<string, RunnerStatus>): string | null {
  const installed = SEEDABLE_RUNNERS.map((id) => runners.get(id)).filter(
    (status): status is RunnerStatus => status !== undefined && status.installed,
  )

  const chosen = installed.find((status) => status.ready) ?? installed[0]
  return chosen ? chosen.id : null
}
