import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
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
      if (!entry.isDirectory()) continue
      const path = join(root, entry.name)
      loaded.push({
        name: entry.name,
        path,
        files: await listFiles(path),
        lastEditedMs: (await stat(path)).mtimeMs,
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
