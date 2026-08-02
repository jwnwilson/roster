import { DataSourceBadge } from "../../components/DataSourceBadge";
import { Avatar } from "../../components/ui/Avatar";
import { StatusCircle } from "../../components/ui/StatusCircle";
import { useWorkItems } from "../../lib/api/hooks";
import type { WorkItem } from "../../lib/api/types";
import { STATUSES, STATUS_LABELS, groupByStatus } from "./groupByStatus";

export interface BoardViewProps {
  projectId: string | undefined;
}

function Card({ item }: { item: WorkItem }) {
  return (
    <article
      className={`rounded-7 bg-[#141618] p-[10px] ${
        item.status === "in_progress" ? "border border-accent-border" : ""
      }`}
    >
      <div className="flex items-center">
        <span className="font-mono text-9-5 text-text-6">{item.key}</span>
        {item.agent_name && (
          <span className="ml-auto">
            <Avatar
              initials={item.agent_name.slice(0, 2).toUpperCase()}
              variant="agent"
              size={17}
              title={item.agent_name}
            />
          </span>
        )}
      </div>
      <p className="mt-1 text-12 leading-[1.4] text-[#c8c9ce]">{item.title}</p>
    </article>
  );
}

export function BoardView({ projectId }: BoardViewProps) {
  const { data, isPending, isError } = useWorkItems(projectId);

  if (!projectId) {
    return (
      <p className="p-6 text-12 text-text-3">
        Choose a project to see its board.
      </p>
    );
  }
  if (isPending) return <p className="p-6 text-12 text-text-4">Loading the board…</p>;
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-end px-4 pt-2">
        <DataSourceBadge screen="board" />
      </div>
      {items.length === 0 ? (
        <p className="p-6 text-12 text-text-3">No work items yet in this project.</p>
      ) : (
        <div className="flex min-h-0 flex-1">
          {STATUSES.map((status) => (
            <section
              key={status}
              data-testid={`column-${status}`}
              className={`flex flex-1 flex-col gap-2 border-r border-[rgba(255,255,255,0.05)] p-3 ${
                status === "in_progress" ? "bg-[#0c0d10]" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <StatusCircle status={status} size={12} />
                <h2 className="text-11-5 font-semibold text-text-2">{STATUS_LABELS[status]}</h2>
                <span className="font-mono text-9-5 text-text-6">{grouped[status].length}</span>
              </div>
              {grouped[status].map((item) => (
                <Card key={item.id} item={item} />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
