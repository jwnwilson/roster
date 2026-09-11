import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pluginManifestPath } from './paths'

/**
 * Presenting `~/roster/skills` to Claude Code as a plugin.
 *
 * The runner passes `settingSources: []`, so neither the user's own
 * `~/.claude/skills` nor the checked-out project's is loaded — which is the
 * point, since an agent's skills are what its agent.toml names. But that also
 * means nothing is discovered, and a skill handed over as a readable directory
 * is not a skill the model can invoke. A local plugin is the one mechanism
 * that registers skills from a path Roster chooses, whatever the agent's
 * working directory happens to be.
 */

/** The plugin's name, and so the namespace its skills may be qualified by. */
export const ROSTER_PLUGIN_NAME = 'roster'

/**
 * Writes the manifest unless one is already there.
 *
 * Never overwritten: it sits in the user's own directory alongside every other
 * file Roster owns and hand-edits, and clobbering an edit on every launch
 * would make it the one file here that cannot be changed.
 */
export async function writeSkillPluginManifest(): Promise<void> {
  const manifest = {
    name: ROSTER_PLUGIN_NAME,
    description: "Roster's shared skill library.",
    // A directory, not a list of skills: the library changes as the user adds
    // to it, and a manifest naming each one would go stale on every create.
    skills: ['./skills/'],
  }

  await mkdir(dirname(pluginManifestPath()), { recursive: true })
  await writeFile(pluginManifestPath(), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    // Fails when it exists rather than racing a read, so a manifest the user
    // has edited survives.
    flag: 'wx',
  }).catch((cause: unknown) => {
    if (isAlreadyThere(cause)) return
    throw cause
  })
}

function isAlreadyThere(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'EEXIST'
}
