export const HEALTH_TIMEOUT_MS = 30_000;
export const HEALTH_INTERVAL_MS = 250;

export class HealthTimeout extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`${url} did not become healthy within ${timeoutMs}ms`);
    this.name = "HealthTimeout";
  }
}

export interface HealthOptions {
  url: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Poll until the server answers, or the budget runs out.
 *
 * A refused connection and a non-200 are the same thing here — "not yet" — so
 * both are swallowed until the deadline. The clock is injected so the timeout
 * is testable without waiting 30 real seconds.
 */
export async function waitForHealth(options: HealthOptions): Promise<void> {
  const {
    url,
    fetchImpl,
    sleep,
    now,
    timeoutMs = HEALTH_TIMEOUT_MS,
    intervalMs = HEALTH_INTERVAL_MS,
  } = options;

  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) return;
    } catch {
      // Connection refused while uvicorn is still binding. Expected.
    }
    if (now() >= deadline) throw new HealthTimeout(url, timeoutMs);
    await sleep(intervalMs);
  }
}
