import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { ProvisionDeps } from './provision'

/**
 * The real commands and filesystem a provision runs against.
 *
 * GIT_TERMINAL_PROMPT=0 makes git fail rather than ask for a password: Roster
 * stores no credentials, so a clone that needs one must stop and say so.
 */
export function systemProvisionDeps(onStep: (step: string) => void): ProvisionDeps {
  return {
    run: (file, args, cwd) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          file,
          args,
          {
            cwd,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            maxBuffer: 32 * 1024 * 1024,
          },
          (error, stdout, stderr) => {
            if (error) {
              const detail = (String(stderr) || error.message).trim().slice(-800)
              reject(new Error(`${file} ${args.join(' ')} failed: ${detail}`))
              return
            }
            resolve(String(stdout).trim())
          },
        )
      }),
    exists: (path) => existsSync(path),
    readText: (path) => readFile(path, 'utf8').catch(() => ''),
    writeText: (path, text) => writeFile(path, text),
    mkdir: async (path) => {
      await mkdir(path, { recursive: true })
    },
    onStep,
  }
}
