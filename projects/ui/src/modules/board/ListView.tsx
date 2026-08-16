import { DataSourceBadge } from "../../components/DataSourceBadge";
import { Avatar } from "../../components/ui/Avatar";
import { PriorityBars } from "../../components/ui/PriorityBars";
import { StatusCircle } from "../../components/ui/StatusCircle";
import { useWorkItems } from "../../lib/api/hooks";
import type { WorkItem } from "../../lib/api/types";
import { STATUSES, STATUS_LABELS, groupByStatus } from "./groupByStatus";

/** Screen A — Issues List. The same work items as the board, grouped into rows
 *  rather than columns; the topbar's view switcher moves between them. */
export function ListView({ projectId }: { projectId: string | undefined }) {
  const { data, isPending, isError } = useWorkItems(projectId);

  if (!projectId) {
    return <p className="p-6 text-12 text-text-3">Choose a project to see its issues.</p>;
  }
  if (isPending) return <p className="p-6 text-12 text-text-4">Loading the issues…</p>;
  if (isError) {
    return (
      <p role="alert" className="p-6 text-12 text-badge-action-text">
        Could not load this project&rsquo;s work items.
      </p>
    );
  }

  const items = data.results;
  const grouped = groupByStatus(items);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex justify-end px-4 pt-2">
        <DataSourceBadge screen="issuesList" />
      </div>

      {items.length === 0 ? (
        <p className="p-6 text-12 text-text-3">No work items yet in this project.</p>
      ) : (
        STATUSES.filter((status) => grouped[status].length > 0).map((status) => (
          <section key={status} data-testid={`group-${status}`}>
            <div className="flex h-[30px] items-center gap-2 bg-bg-column-header px-[14px]">
              <StatusCircle status={status} size={13} />
              <h2 className="text-11-5 font-semibold text-text-2">{STATUS_LABELS[status]}</h2>
              <span className="font-mono text-9-5 text-text-6">{grouped[status].length}</span>
            </div>
            <ul>
              {grouped[status].map((item: WorkItem) => (
                <li
                  key={item.id}
                  className="flex h-[34px] items-center gap-3 border-b border-overlay-03 px-[14px]"
                >
                  <PriorityBars priority={item.priority} />
                  <StatusCircle status={item.status} size={13} />
                  <span className="w-[62px] shrink-0 font-mono text-10-5 text-text-6">
                    {item.key}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-12-5 ${
                      item.status === "in_progress" ? "text-text-strong" : "text-text-message"
                    }`}
                  >
                    {item.title}
                  </span>
                  {item.agent_name && (
                    <Avatar
                      initials={item.agent_name.slice(0, 2).toUpperCase()}
                      variant="agent"
                      size={18}
                      title={item.agent_name}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
