import { useEffect } from "react";

import { reconnectDelay } from "./reconnect";

/** Message kinds the backend names its frames with, plus its idle-timeout frame. */
const FRAMES = ["text", "file_write", "question", "event", "stream_timeout"] as const;

export interface ThreadStreamOptions {
  /** Stops the subscription entirely — used for a resolved thread. */
  enabled?: boolean;
  onFrame: () => void;
}

/**
 * Subscribe to a thread's live messages.
 *
 * **Used as a signal, not a payload.** The stream sends `event: <kind>` with the
 * message *content* as `data` — it carries no author or timestamp, so rendering
 * from it would mean reconstructing a Message the server already knows how to
 * build. Instead each frame triggers a refetch, and the list stays the API's
 * shape. That also means a dropped frame self-heals on the next one.
 *
 * **A resolved thread is never subscribed to.** The backend closes that stream
 * deliberately — it is a normal end, not a failure — and reconnecting to it with
 * backoff forever is exactly the bug this guard exists to prevent.
 */
export function useThreadStream(
  threadId: string | undefined,
  { enabled = true, onFrame }: ThreadStreamOptions,
): void {
  useEffect(() => {
    if (!threadId || !enabled) return;
    if (typeof EventSource === "undefined") return;
    // MSW cannot intercept EventSource, so in mock-first mode there is nothing
    // to connect to: the request reaches the always-on Vite proxy, gets
    // ECONNREFUSED, and the backoff loop retries forever per open thread. Spec
    // §6 requires the app to run with no backend, so the subscription is simply
    // not opened there.
    if (import.meta.env.VITE_USE_MOCKS === "true") return;

    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      source = new EventSource(`/api/threads/${threadId}/stream`);
      source.onopen = () => {
        attempt = 0; // a healthy connection resets the backoff
      };
      for (const frame of FRAMES) {
        source.addEventListener(frame, () => onFrame());
      }
      source.onerror = () => {
        source?.close();
        if (stopped) return;
        timer = setTimeout(connect, reconnectDelay(attempt));
        attempt += 1;
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
    // `onFrame` is deliberately not a dependency: it changes every render, and
    // depending on it would tear the stream down and reopen it continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, enabled]);
}
