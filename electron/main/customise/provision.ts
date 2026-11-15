import { dirname, join } from 'node:path'

/**
 * Turns an empty folder into a working customised copy. Every step checks
 * what is already true before it acts, so a provision that failed halfway can
 * simply be run again: no second clone, no duplicate remote, no new branch.
 *
 * Nothing here reads the user's credentials. git and gh must already be
 * logged in on this machine; a clone that asks for a password fails instead
 * of prompting, because the caller sets GIT_TERMINAL_PROMPT=0.
 */

export interface ProvisionInput {
  /** The checkout, at ~/roster/customisations/<id>. */
  path: string
  /** ROSTER_HOME for the copy: <path>/home, kept out of git. */
  homeDir: string
  /** The Roster repository the copy is cloned from. */
  sourceUrl: string
  /** The user's fork, or null for a copy that is not published anywhere. */
  forkUrl: string | null
  branch: string
  /** Null means the warning was never acknowledged, and nothing may run. */
  acknowledgedAt: number | null
}

export interface ProvisionDeps {
  /** Resolves the command's trimmed stdout, or rejects with its stderr. */
  run(file: string, args: string[], cwd?: string): Promise<string>
  exists(path: string): boolean
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  mkdir(path: string): Promise<void>
  /** A short line for the progress view. */
  onStep(step: string): void
}

export interface ProvisionResult {
  /**
   * The commit a fresh clone started from. Null when this run did not clone,
   * so the caller keeps the base it already recorded.
   */
  baseSha: string | null
}

const HOME_EXCLUDE = '/home/'

export async function provisionCustomisation(
  input: ProvisionInput,
  deps: ProvisionDeps,
): Promise<ProvisionResult> {
  if (input.acknowledgedAt === null) {
    throw new Error('Acknowledge the warning before a copy is created.')
  }

  const git = (args: string[]): Promise<string> => deps.run('git', args, input.path)
  let baseSha: string | null = null

  if (!deps.exists(join(input.path, '.git'))) {
    deps.onStep('Cloning Roster main…')
    await deps.mkdir(dirname(input.path))
    await deps.run('git', ['clone', '--branch', 'main', input.sourceUrl, input.path])
    baseSha = await git(['rev-parse', 'HEAD'])
  }

  // The clone's own origin is the Roster repository. It becomes upstream, so
  // origin can belong to the user's fork and the two never get confused.
  deps.onStep('Setting up remotes…')
  let names = lines(await git(['remote']))
  if (!names.includes('upstream') && names.includes('origin')) {
    await git(['remote', 'rename', 'origin', 'upstream'])
    names = lines(await git(['remote']))
  }
  if (input.forkUrl !== null) {
    if (names.includes('origin')) await git(['remote', 'set-url', 'origin', input.forkUrl])
    else await git(['remote', 'add', 'origin', input.forkUrl])
  }

  // The copy's data lives beside the checkout, so it must never be committed.
  const excludePath = join(input.path, '.git', 'info', 'exclude')
  await deps.mkdir(input.homeDir)
  const exclude = await deps.readText(excludePath)
  if (!lines(exclude).includes(HOME_EXCLUDE)) {
    const separator = exclude === '' || exclude.endsWith('\n') ? '' : '\n'
    await deps.writeText(excludePath, `${exclude}${separator}${HOME_EXCLUDE}\n`)
  }

  deps.onStep('Creating your branch…')
  if ((await git(['branch', '--list', input.branch])) === '') {
    await git(['checkout', '-b', input.branch])
  }

  deps.onStep('Installing dependencies. This can take a few minutes.')
  await deps.run('npm', ['install'], input.path)

  // npm does not always fetch Electron's binary in a fresh clone. Without it
  // the copy cannot start, so fetch it explicitly when it is missing.
  if (!deps.exists(join(input.path, 'node_modules', 'electron', 'dist'))) {
    deps.onStep('Fetching the Electron binary…')
    await deps.run('node', ['node_modules/electron/install.js'], input.path)
  }

  return { baseSha }
}

function lines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}
