import { existsSync, watch, type FSWatcher } from 'node:fs'
import { lstat, mkdir, readdir, readFile, readlink, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { Skill } from '../../../shared/types'
import type { Disposable } from './agents'
import { skillsDir } from './paths'

/**
 * File-backed store over `~/roster/skills`. Each skill is a folder holding a
 * SKILL.md and any supporting files.
 */
export class SkillStore {
  private skills: Skill[] = []
  private watcher: FSWatcher | null = null
  private listeners = new Set<(skills: Skill[]) => void>()

  async load(): Promise<void> {
    const root = skillsDir()
    await mkdir(root, { recursive: true })
    const entries = await readdir(root, { withFileTypes: true })

    const loaded: Skill[] = []
    for (const entry of entries) {
      const path = join(root, entry.name)

      // A linked skill is a symlink to a folder the user keeps elsewhere.
      // stat follows it, so everything below reads through the link.
      const linkedFrom = entry.isSymbolicLink() ? await linkTarget(path) : null
      if (!entry.isDirectory() && linkedFrom === null) continue

      loaded.push({
        name: entry.name,
        path,
        files: await listFiles(path),
        lastEditedMs: (await stat(path)).mtimeMs,
        ...(linkedFrom !== null ? { linkedFrom } : {}),
      })
    }

    this.skills = loaded.sort((a, b) => a.name.localeCompare(b.name))
  }

  findAll(): Skill[] {
    return this.skills
  }

  /**
   * Reads a file inside the skill library. The path is confined to the skills
   * root so a crafted request cannot walk out into the filesystem.
   */
  async read(path: string): Promise<string> {
    return readFile(this.confine(path), 'utf8')
  }

  async write(path: string, contents: string): Promise<void> {
    await writeFile(this.confine(path), contents, 'utf8')
  }

  /**
   * Creates a skill folder with a starter SKILL.md. The name is slugified
   * because it is also a directory name, and a clashing name is suffixed
   * rather than silently overwriting someone's work.
   */
  async create(name: string): Promise<Skill> {
    const base = slugify(name)
    const unique = await this.uniqueName(base)
    const dir = join(skillsDir(), unique)

    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), starterSkill(name.trim() || unique), 'utf8')
    await this.load()

    const created = this.skills.find((skill) => skill.name === unique)
    if (!created) throw new Error(`created "${unique}" but could not read it back`)
    return created
  }

  /**
   * Adds a folder the user already has as a skill, by linking rather than
   * copying.
   *
   * A copy would go stale the moment either side changed, and skills people
   * already have tend to live in a repo they keep working on. Linking means
   * Roster's editor edits the real file and the runner gets the real path.
   */
  async link(source: string): Promise<Skill> {
    const target = resolve(source)

    const info = await lstat(target).catch(() => null)
    if (info === null) throw new Error(`there is nothing at ${target}`)
    if (!(await stat(target)).isDirectory()) throw new Error(`${target} is not a folder`)
    if (!existsSync(join(target, SKILL_FILE))) {
      throw new Error(`${basename(target)} has no ${SKILL_FILE}, so it is not a skill`)
    }

    // Linking the library into itself would make load() walk in circles.
    const root = resolve(skillsDir())
    if (target === root || target.startsWith(root + sep)) {
      throw new Error('that folder is already in the skill library')
    }

    const already = this.skills.find((skill) => skill.linkedFrom === target)
    if (already) throw new Error(`already added as "${already.name}"`)

    const name = await this.uniqueName(slugify(basename(target)))
    await mkdir(root, { recursive: true })
    await symlink(target, join(root, name), 'dir')
    await this.load()

    const linked = this.skills.find((skill) => skill.name === name)
    if (!linked) throw new Error(`linked "${name}" but could not read it back`)
    return linked
  }

  private async uniqueName(base: string): Promise<string> {
    const taken = new Set(this.skills.map((skill) => skill.name))
    if (!taken.has(base)) return base

    for (let n = 2; n < 1_000; n += 1) {
      if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
    }
    throw new Error(`could not find a free name for "${base}"`)
  }

  /**
   * Creates an empty file inside a skill, along with any parent folders the
   * path implies. Returns its absolute path.
   *
   * The relative path is confined to the skill's own folder: it is typed by a
   * user, and `../` in it would otherwise write anywhere on disk.
   */
  async createFile(skillName: string, relativePath: string): Promise<string> {
    const target = this.resolveInSkill(skillName, relativePath)

    if (existsSync(target)) throw new Error(`"${relativePath}" already exists`)

    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, '', { encoding: 'utf8', flag: 'wx' })
    await this.load()
    return target
  }

  /** Creates a folder inside a skill. Returns its absolute path. */
  async createFolder(skillName: string, relativePath: string): Promise<string> {
    const target = this.resolveInSkill(skillName, relativePath)

    if (existsSync(target)) throw new Error(`"${relativePath}" already exists`)

    await mkdir(target, { recursive: true })
    await this.load()
    return target
  }

  /**
   * Resolves a user-typed relative path inside one skill, refusing anything
   * that escapes it. Confinement is checked after resolution, so `../` and
   * symlink-ish trickery are both caught.
   */
  private resolveInSkill(skillName: string, relativePath: string): string {
    const trimmed = relativePath.trim()
    if (trimmed === '') throw new Error('a name is required')
    if (isAbsolute(trimmed)) throw new Error('an absolute path is not allowed here')

    const root = this.pathOf(skillName)
    if (root === null) throw new Error(`unknown skill "${skillName}"`)

    const target = resolve(root, trimmed)
    if (target !== root && !target.startsWith(resolve(root) + sep)) {
      throw new Error(`"${relativePath}" would land outside the skill`)
    }
    if (target === resolve(root)) throw new Error('a name is required')

    return target
  }

  /**
   * Moves a file or folder inside a skill to the Trash.
   *
   * Trash rather than unlink: these are the user's own files, and a mistaken
   * click should be recoverable from the OS rather than gone.
   */
  async remove(skillName: string, relativePath: string): Promise<void> {
    const target = this.resolveInSkill(skillName, relativePath)
    if (!existsSync(target)) throw new Error(`"${relativePath}" is no longer there`)

    await this.toTrash(target)
    await this.load()
  }

  /**
   * Removes a whole skill: a linked one is unlinked, a real one is trashed.
   *
   * Trashing a link would be ambiguous at best and would take the user's own
   * folder with it at worst. Removing a link destroys nothing, so it does not
   * need the Trash to be recoverable from.
   */
  async removeSkill(skillName: string): Promise<void> {
    const skill = this.skills.find((candidate) => candidate.name === skillName)
    if (!skill) throw new Error(`unknown skill "${skillName}"`)

    if (skill.linkedFrom !== undefined) await unlink(skill.path)
    else await this.toTrash(skill.path)

    await this.load()
  }

  /**
   * Injected so the store can be tested without a desktop Trash; the real
   * implementation is Electron's shell.trashItem.
   */
  constructor(private readonly toTrash: (path: string) => Promise<void> = defaultTrash) {}

  /** Absolute path of a skill folder, for revealing it in the file manager. */
  pathOf(name: string): string | null {
    return this.skills.find((skill) => skill.name === name)?.path ?? null
  }

  private confine(path: string): string {
    const root = resolve(skillsDir())
    const target = resolve(path)
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`refusing to read outside the skill library: ${path}`)
    }
    return target
  }

  watch(onChange: (skills: Skill[]) => void): Disposable {
    this.listeners.add(onChange)
    this.startWatching()
    return {
      dispose: () => {
        this.listeners.delete(onChange)
        if (this.listeners.size === 0) this.stopWatching()
      },
    }
  }

  private startWatching(): void {
    if (this.watcher) return
    let pending: NodeJS.Timeout | null = null

    this.watcher = watch(skillsDir(), { recursive: true }, () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        void this.load().then(() => {
          for (const listener of this.listeners) listener(this.skills)
        })
      }, 80)
    })
  }

  private stopWatching(): void {
    this.watcher?.close()
    this.watcher = null
  }

  dispose(): void {
    this.listeners.clear()
    this.stopWatching()
  }
}

/** Every skill folder has one; it is what makes the folder a skill. */
const SKILL_FILE = 'SKILL.md'

/** Where a symlink points, or null when it dangles or is not a folder. */
async function linkTarget(path: string): Promise<string | null> {
  try {
    if (!(await stat(path)).isDirectory()) return null
    return resolve(dirname(path), await readlink(path))
  } catch {
    // A link to somewhere that no longer exists is not a skill.
    return null
  }
}

/** Falls back to a permanent delete only where no desktop Trash exists. */
async function defaultTrash(path: string): Promise<void> {
  const { shell } = await import('electron')
  await shell.trashItem(path)
}

/** Skill names double as directory names, so they must be filesystem-safe. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'new-skill' : slug
}

function starterSkill(title: string): string {
  return `# ${title}

One line on what this skill is for.

## When to use

- The situation that should trigger it

## Steps

1. The first thing to do
`
}

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const label = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(`${label}/`)
      files.push(...(await listFiles(join(dir, entry.name), label)))
    } else {
      files.push(label)
    }
  }

  return files.sort()
}
