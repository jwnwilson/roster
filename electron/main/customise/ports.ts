import { createServer } from 'node:net'

/**
 * Dev ports for customised copies. The official app holds 5173, and this
 * range sits clear of it and of the other common local servers below 5200.
 */
export const PORT_RANGE = { start: 5180, end: 5299 } as const

/**
 * The first port in the range that no copy already holds and that is free
 * right now. The taken list comes from the database, so two copies are never
 * given the same port even when neither is running.
 */
export async function pickDevPort(
  taken: readonly number[],
  isFree: (port: number) => Promise<boolean>,
  range: { start: number; end: number } = PORT_RANGE,
): Promise<number> {
  const claimed = new Set(taken)
  for (let port = range.start; port <= range.end; port++) {
    if (claimed.has(port)) continue
    if (await isFree(port)) return port
  }
  throw new Error(`No free port between ${range.start} and ${range.end} for a customised copy.`)
}

/** Whether nothing is listening on the port on this machine. */
export function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}
