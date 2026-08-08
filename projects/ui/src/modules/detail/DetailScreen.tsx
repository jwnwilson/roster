import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { DataSourceBadge } from "../../components/DataSourceBadge";
import { StatusCircle } from "../../components/ui/StatusCircle";
import { useWorkItem } from "../../lib/api/hooks";
import { ApiError } from "../../lib/api/client";
import { queryKeys } from "../../lib/api/queryKeys";
import type { WorkItemStatus } from "../../lib/api/types";
import { updateWorkItem } from "../../lib/api/workItems";
import { STATUSES, STATUS_LABELS } from "../board/groupByStatus";
import { ActivityTab } from "./ActivityTab";
import { AttachmentsTab } from "./AttachmentsTab";
import { SpecTab } from "./SpecTab";
import { ThreadTab } from "./ThreadTab";

/** Spec · Attachments · Activity · Thread. There is no Agent tab and no run
 *  monitor — the design removed it and agent output is read in Thread (spec §6). */
const TABS = ["Spec", "Attachments", "Activity", "Thread"] as const;
type Tab = (typeof TABS)[number];

export interface DetailScreenProps {
  projectId: string | undefined;
  itemId: string | undefined;
}

export function DetailScreen({ projectId, itemId }: DetailScreenProps) {
  const [tab, setTab] = useState<Tab>("Spec");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: item, isPending, isError, missing } = useWorkItem(projectId, itemId);

  const move = useMutation({
    mutationFn: (status: WorkItemStatus) => updateWorkItem(itemId!, { status }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.workItems(projectId ?? "none") }),
    onError: (cause: unknown) => {
      // The API distinguishes a legal status in an illegal position (409, a real
      // user error worth reading) from a value it does not accept at all (422,
      // which means this client sent something wrong).
      const status = cause instanceof ApiError ? cause.status : 0;
      const message = cause instanceof Error ? cause.message : "Unexpected error";
      setError(status === 409 ? message : `Unexpected problem saving that change — ${message}`);
    },
  });

  if (isPending) return <p className="p-6 text-12 text-text-4">Loading the work item…</p>;
  if (isError) {
    return (
      <p role="alert" className="p-6 text-12 text-badge-action-text">
        Could not load this project&rsquo;s work items.
      </p>
    );
  }
  if (missing || !item) {
    return (
      <p className="p-6 text-12 text-text-3">
        Could not find that work item in this project.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[34px] items-center gap-2 px-4 font-mono text-11 text-text-5">
        <span className="text-text-3">{item.key}</span>
        <DataSourceBadge screen="workItemSpec" />
      </div>

      <div className="flex items-center gap-3 px-4 pt-1">
        <StatusCircle status={item.status} size={14} />
        <h1 className="text-[17px] font-semibold text-text-1">{item.title}</h1>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <label className="flex items-center gap-2 text-11 text-text-3">
          Status
          <select
            value={item.status}
            onChange={(event) => {
              setError(null);
              move.mutate(event.target.value as WorkItemStatus);
            }}
            className="h-[28px] rounded-5 border border-border-strong bg-bg-input px-2 text-11 text-text-3"
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        {item.agent_name && (
          <span className="text-11 text-text-3">Agent: {item.agent_name}</span>
        )}
      </div>

      {error && (
        <p role="alert" className="px-4 pb-2 text-11-5 text-badge-action-text">
          {error}
        </p>
      )}

      <div className="flex gap-4 border-b border-border-subtle px-4" role="tablist">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`border-b-2 pb-2 text-11-5 ${
              tab === name
                ? "border-accent font-medium text-accent-text"
                : "border-transparent text-text-5"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === "Spec" && <SpecTab spec={item.spec} />}
      {tab === "Activity" && <ActivityTab />}
      {tab === "Attachments" && <AttachmentsTab />}
      {tab === "Thread" && <ThreadTab workItemId={item.id} />}
    </div>
  );
}
