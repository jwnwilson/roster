/** Capped exponential backoff (ms) for reconnect attempt `attempt` (0-based).
 *
 * Lives on its own because the generic `useEventSource` hook it came with could
 * not be used against roster's stream: that hook parses `data` as JSON and
 * listens only for unnamed events, while the backend names every frame by
 * message kind and sends the message content as plain text. `useThreadStream`
 * replaced it; this is the one piece worth keeping.
 */
export function reconnectDelay(attempt: number, baseMs = 1000, maxMs = 15000): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}
