import { screenProvenance } from "../lib/api/capabilities";
import type { ScreenKey } from "../lib/api/capabilities";
import { CAPABILITIES } from "../lib/api/capabilities";

/** Dev-only marker naming how much of a screen is fixtures.
 *
 * Renders nothing when the screen is fully live and nothing at all in a
 * production build — the point is that nobody developing against this app can
 * mistake a mocked screen for a working one, not that users see plumbing. */
export function DataSourceBadge({ screen }: { screen: ScreenKey }) {
  if (!import.meta.env.DEV) return null;

  const { live, unbacked } = screenProvenance(screen);
  if (live) return null;

  const detail = unbacked
    .map((key) => {
      const entry = CAPABILITIES[key];
      return `${key} — ${entry.status === "unbacked" ? entry.reason : ""}`;
    })
    .join("\n");

  return (
    <span
      data-testid="data-source-badge"
      title={detail}
      className="rounded-4 border border-badge-review-border bg-badge-review-bg px-[6px] py-[2px] font-mono text-9-5 text-badge-review-text"
    >
      {unbacked.length} mocked
    </span>
  );
}
