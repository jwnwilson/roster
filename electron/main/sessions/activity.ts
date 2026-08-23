/**
 * Turns a tool call into the phrase the streaming indicator shows.
 *
 * The design handoff writes these as "Reading src/session/pool.ts …" rather
 * than naming the tool, so the reader sees the work rather than the mechanism.
 * This matters most for a runner that does not stream: without it the pane
 * sits silent for the length of the turn.
 */
const VERBS: { match: RegExp; verb: string }[] = [
  { match: /^(read|view|cat)$/i, verb: 'Reading' },
  { match: /^(write|create)$/i, verb: 'Writing' },
  { match: /^(edit|str_replace|multiedit|apply_patch)$/i, verb: 'Editing' },
  { match: /^(bash|shell|run_command|exec)$/i, verb: 'Running' },
  { match: /^(grep|search|ripgrep)$/i, verb: 'Searching' },
  { match: /^(glob|ls|list)$/i, verb: 'Looking through' },
  { match: /^(webfetch|web_fetch|fetch)$/i, verb: 'Fetching' },
  { match: /^(websearch|web_search)$/i, verb: 'Searching the web for' },
  { match: /^task$/i, verb: 'Delegating' },
]

/** Shown while the agent is between tool calls. */
export const THINKING = 'Thinking …'

/** Long arguments are trimmed; the indicator is one line. */
const MAX_TARGET = 60

export function describeActivity(toolName: string, args: string): string {
  const verb = VERBS.find((entry) => entry.match.test(toolName))?.verb
  const target = trim(args)

  // An unrecognised tool still reads sensibly: "Running my_tool …".
  if (verb === undefined) return target === '' ? `Running ${toolName} …` : `${toolName}: ${target} …`
  return target === '' ? `${verb} …` : `${verb} ${target} …`
}

function trim(args: string): string {
  const line = args.split('\n')[0]?.trim() ?? ''
  if (line.length <= MAX_TARGET) return line
  return `${line.slice(0, MAX_TARGET - 1)}…`
}
