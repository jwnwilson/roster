/**
 * The renderer dev server's port.
 *
 * Fixed at 5173 for the official app, so nothing about it changes for
 * anyone. A customised copy sets ROSTER_DEV_PORT so it can run beside the
 * official app, which already holds 5173. Read by electron.vite.config.ts,
 * which is why it lives in shared/ rather than in the main process.
 */
export const DEFAULT_DEV_PORT = 5173

export function parseDevPort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_DEV_PORT
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`ROSTER_DEV_PORT must be a TCP port from 1 to 65535, got "${value}"`)
  }
  return port
}
