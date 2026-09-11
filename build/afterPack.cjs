// Fails the build if the packaged app carries CLI binaries for the wrong CPU.
//
// `@anthropic-ai/claude-agent-sdk` and `@openai/codex-sdk` each ship their real
// executable in a per-platform optional package — `…-darwin-arm64`,
// `…-darwin-x64` — and npm installs only the one matching the machine doing the
// install. Nothing downstream checks that it also matches the app being built,
// so an arm64 app packaged on an Intel machine gets x64 binaries and looks
// perfectly fine until an agent runs, at which point the SDK reports the
// binary for this platform as "not found".
//
// That shipped. v0.1.28's arm64 DMG held darwin-x64 binaries, because both
// build jobs built both architectures and the Intel runner's arm64 DMG
// overwrote the correct one. The arch list is gone from the mac target now, so
// each job builds only its own — but the reason this was worth finding twice
// is that nothing failed. A wrong-arch bundle is only detectable at runtime,
// on the user's machine.
//
// So it is asserted here, per arch, on every build including local ones.

const { readdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')

/** electron-builder passes `Arch` as its enum ordinal, not a name. */
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal']

/**
 * A per-platform package, as npm names one: `<something>-<platform>-<arch>`,
 * optionally with a libc suffix (`-linux-x64-musl`).
 */
const PLATFORM_PACKAGE = /-(darwin|win32|linux)-(ia32|x64|armv7l|arm64)(-musl)?$/

/**
 * The packages whose architecture is not the one being built.
 *
 * Pure, and exported, because it is the part worth testing: the walk around it
 * is filesystem plumbing, and this is the rule.
 *
 * A `universal` build legitimately carries both, so nothing is wrong there.
 *
 * @param {readonly string[]} names package directory names
 * @param {string} targetArch the arch being packaged
 * @returns {string[]} the offending names, in the order given
 */
function wrongArchPackages(names, targetArch) {
  if (targetArch === 'universal') return []

  return names.filter((name) => {
    const match = PLATFORM_PACKAGE.exec(name)
    return match !== null && match[2] !== targetArch
  })
}

/**
 * Every package directory under a `node_modules`, with scopes flattened so
 * `@openai/codex-darwin-x64` is reported by the name that carries the arch.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function packageNames(dir) {
  if (!existsSync(dir)) return []

  const names = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith('@')) {
      names.push(entry.name)
      continue
    }

    for (const scoped of readdirSync(join(dir, entry.name), { withFileTypes: true })) {
      if (scoped.isDirectory()) names.push(scoped.name)
    }
  }

  return names
}

/**
 * Where the unpacked modules live inside a packaged app.
 *
 * Only macOS is built today, but the other two are cheap to be right about and
 * a guard that silently checks nothing is worse than no guard.
 *
 * @param {string} appOutDir
 * @param {string} platform electronPlatformName
 * @returns {string | null}
 */
function unpackedModules(appOutDir, platform) {
  if (platform !== 'darwin') {
    return join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules')
  }

  const app = readdirSync(appOutDir).find((name) => name.endsWith('.app'))
  if (app === undefined) return null

  return join(appOutDir, app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules')
}

/** @param {{appOutDir: string, arch: number, electronPlatformName: string}} context */
async function afterPack(context) {
  const targetArch = ARCH_NAMES[context.arch] ?? String(context.arch)
  const modules = unpackedModules(context.appOutDir, context.electronPlatformName)

  if (modules === null) {
    throw new Error(`arch guard: no .app found in ${context.appOutDir}`)
  }

  const wrong = wrongArchPackages(packageNames(modules), targetArch)
  if (wrong.length === 0) return

  throw new Error(
    `arch guard: packaging ${targetArch} but bundled ${wrong.join(', ')}.\n` +
      `The install that produced node_modules was for a different CPU, so the ` +
      `agent CLIs in this build cannot run. Reinstall on a ${targetArch} machine ` +
      `— or build ${targetArch} only there — and package again.`,
  )
}

module.exports = afterPack
module.exports.default = afterPack
module.exports.wrongArchPackages = wrongArchPackages
