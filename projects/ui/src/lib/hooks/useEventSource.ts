import { useEffect, useRef } from "react";

/**
 * The connection identity of an SSE url: its path without the query string.
 *
 * Two urls that differ only in query (e.g. an advancing `?after=` cursor) share
 * one connection, so the live stream is not torn down every time the cursor
 * moves — the new cursor is used only on the next reconnect.
 */
export function ssePath(url: string | null): string | null {
  return url ? url.split("?")[0] : null;
}

/** Capped exponential backoff (ms) for reconnect attempt `attempt` (0-based). */
export function reconnectDelay(attempt: number, baseMs = 1000, maxMs = 15000): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

/**
 * Resilient SSE subscription.
 *
 * Opens an `EventSource` to `url` and forwards parsed frames to `onMessage`.
 * - Reconnects on error with capped backoff, so a backend hiccup or a stream
 *   that closes at its safety deadline recovers without a page reload.
 * - Only tears down + reopens when the url *path* changes. Query-string changes
 *   (an advancing `?after=` cursor) update the value used on the next reconnect
 *   WITHOUT dropping the live stream, so a resuming reconnect picks up from the
 *   latest cursor instead of replaying the whole backlog.
 */
export function useEventSource<T>(url: string | null, onMessage: (data: T) => void): void {
  const cb = useRef(onMessage);
  cb.current = onMessage;
  // Latest url (with the current cursor), read at (re)connect time.
  const urlRef = useRef(url);
  urlRef.current = url;

  const path = ssePath(url);

  useEffect(() => {
    if (!path) return;
    // Guard: jsdom does not implement EventSource; skip in non-browser environments.
    if (typeof EventSource === "undefined") return;

    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      const current = urlRef.current;
      if (stopped || !current) return;
      es = new EventSource(current);
      es.onopen = () => {
        attempt = 0; // healthy connection resets the backoff
      };
      es.onmessage = (e) => {
        try {
          cb.current(JSON.parse(e.data) as T);
        } catch {
          // Ignore malformed frames.
        }
      };
      es.onerror = () => {
        // Native EventSource retries transient drops but gives up on hard
        // failures; drive our own capped-backoff reconnect so recovery is
        // deterministic and always resumes from the latest cursor in urlRef.
        es?.close();
        if (stopped) return;
        timer = setTimeout(connect, reconnectDelay(attempt));
        attempt += 1;
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [path]);
}
