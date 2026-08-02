import type { WorkItem, WorkItemStatus } from "../../lib/api/types";

/** The five board columns, in the order the design shows them. */
export const STATUSES: readonly WorkItemStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
];

export const STATUS_LABELS: Record<WorkItemStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

/** Every column is present even when empty — a board that hides its empty
 *  columns changes shape as work moves, which is disorienting. */
export function groupByStatus(items: WorkItem[]): Record<WorkItemStatus, WorkItem[]> {
  const grouped = Object.fromEntries(STATUSES.map((status) => [status, [] as WorkItem[]])) as Record<
    WorkItemStatus,
    WorkItem[]
  >;
  for (const item of items) grouped[item.status]?.push(item);
  return grouped;
}
