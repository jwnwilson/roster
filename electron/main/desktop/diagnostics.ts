import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { z } from 'zod'
import type { DesktopReport } from '../../../shared/desktop'

const reportSchema = z.object({
  accessibilityTrusted: z.boolean(),
  screenCaptureAllowed: z.boolean(),
  inputPostingAllowed: z.boolean(),
  visibleScreens: z.number().int().nonnegative(),
  frontmostApp: z.string().nullable(),
})

export function desktopHelperPath(isPackaged = process.defaultApp !== true, resourcesPath = process.resourcesPath, cwd = process.cwd()): string {
  return isPackaged ? join(resourcesPath, 'desktop', 'roster-desktop') : join(cwd, 'build', 'desktop', 'roster-desktop')
}

function runHelper(path: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(path, args, { timeout: 30_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error) reject(new Error(`Desktop diagnostics could not run: ${error.message}`))
      else resolve(stdout)
    })
  })
}

/** No arbitrary commands or agent tools: read-only observation. */
export class DesktopDiagnostics {
  constructor(
    private readonly platform = process.platform,
    private readonly helperPath = desktopHelperPath,
    private readonly run = runHelper,
  ) {}

  check(): Promise<DesktopReport> { return this.execute([]) }

  private async execute(args: string[]): Promise<DesktopReport> {
    if (this.platform !== 'darwin') throw new Error('Desktop diagnostics are currently available on macOS only.')
    const output = await this.run(this.helperPath(), args)
    return reportSchema.parse(JSON.parse(output))
  }
}
