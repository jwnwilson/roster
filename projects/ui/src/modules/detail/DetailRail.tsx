import { DataSourceBadge } from "../../components/DataSourceBadge";
import type { WorkItem } from "../../lib/api/types";
import { attachments, formatBytes } from "../../mocks/unbacked/attachments.list";
import { tokenUsage } from "../../mocks/unbacked/tokens.usage";
import { workItemActivity } from "../../mocks/unbacked/workItems.activity";
import { STATUS_LABELS } from "../board/groupByStatus";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border-subtle px-4 py-3">
      <h2 className="font-mono text-9-5 tracking-[0.07em] text-text-7">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Handoff §Screen D — the 252px right rail.
 *
 * Only PROPERTIES is real. Token usage, the activity timeline and attachments
 * all depend on capabilities no entity carries, so each says so rather than the
 * rail carrying one badge that would tar the properties with the same brush.
 */
export function DetailRail({ item }: { item: WorkItem }) {
  const pct = Math.round((tokenUsage.budget_used / tokenUsage.budget_limit) * 100);

  return (
    <aside
      data-testid="detail-rail"
      className="w-[252px] shrink-0 overflow-auto border-l border-border-subtle"
    >
      <Section title="PROPERTIES">
        <dl data-testid="rail-properties" className="flex flex-col gap-1 text-12">
          {[
            ["Status", STATUS_LABELS[item.status]],
            ["Priority", item.priority],
            ["Agent", item.agent_name ?? "Unassigned"],
            ["Type", item.type],
          ].map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="w-[80px] shrink-0 text-text-5">{key}</dt>
              <dd className={key === "Status" ? "text-accent-text" : "text-text-3"}>{value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="TOKEN USAGE">
        <div className="flex items-center gap-2">
          <span className="font-mono text-10 text-text-4">This run</span>
          <DataSourceBadge screen="workItemSpec" />
        </div>
        <div className="mt-1 h-[3px] rounded-[1px] bg-bg-track">
          <div className="h-full rounded-[1px] bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 font-mono text-10 text-text-4">All runs</div>
        <div className="mt-1 h-[3px] rounded-[1px] bg-bg-track">
          <div className="h-full rounded-[1px] bg-fill-secondary" style={{ width: "72%" }} />
        </div>
      </Section>

      <Section title="RECENT ACTIVITY">
        <ol className="flex flex-col gap-2 border-l border-text-7 pl-3">
          {workItemActivity.slice(0, 3).map((event) => (
            <li key={event.id} className="text-11 text-text-5">
              <span className="text-text-3">{event.actor}</span> {event.summary}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="ATTACHMENTS">
        <ul className="flex flex-col gap-1">
          {attachments.slice(0, 2).map((file) => (
            <li key={file.id} className="flex items-center gap-2 text-11 text-text-4">
              <span className="truncate">{file.filename}</span>
              <span className="ml-auto font-mono text-9 text-text-7">
                {formatBytes(file.bytes)}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </aside>
  );
}
