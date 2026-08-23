/**
 * The message to show a user for a failure that came back over IPC.
 *
 * Electron wraps anything thrown inside an `ipcMain.handle` as
 * `Error invoking remote method 'channel:name': Error: the real message`.
 * That prefix names Roster's own plumbing, which the reader can do nothing
 * with, so it is stripped down to what actually went wrong.
 */
export function messageFor(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)

  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:Error|TypeError|RangeError):\s*/, '')
    .trim()
}
