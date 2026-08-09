import { DataSourceBadge } from "../../components/DataSourceBadge";
import { workItemActivity } from "../../mocks/unbacked/workItems.activity";

/** Entirely fixtures: there is no work-item activity log. Only threads record
 *  what happened, and they are scoped to a conversation rather than to the item.
 *  Registered as `workItems.activity` so nobody mistakes this for real history. */
export function ActivityTab() {
  return (
    <div className="px-6 py-5">
      <div className="flex items-center gap-2 pb-3">
        <span className="font-mono text-9-5 tracking-[0.07em] text-text-7">ACTIVITY HISTORY</span>
        <DataSourceBadge screen="workItemActivity" />
      </div>
      <ol className="flex flex-col gap-3 border-l border-text-7 pl-4">
        {workItemActivity.map((event) => (
          <li key={event.id} className="text-12">
            <span className="font-semibold text-text-2">{event.actor}</span>{" "}
            <span className="text-text-3">{event.summary}</span>
            <div className="font-mono text-9 text-text-7">{event.created_at}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
