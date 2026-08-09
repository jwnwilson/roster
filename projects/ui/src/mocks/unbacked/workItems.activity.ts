import type { WorkItemStatus } from "../../lib/api/types";

/** There is no work-item activity log: only threads record what happened, and
 *  they are scoped to a conversation rather than to the item. Modelled on the
 *  event kinds in handoff §Screen D5 so the eventual API can match this shape
 *  rather than the fixtures inventing their own vocabulary. */
export type ActivityEvent = {
  id: string;
  kind: "status" | "comment" | "attachment" | "assignment" | "created";
  actor: string;
  summary: string;
  from?: WorkItemStatus;
  to?: WorkItemStatus;
  created_at: string;
};

export const workItemActivity: ActivityEvent[] = [
  {
    id: "a3", kind: "status", actor: "atlas",
    summary: "moved this to In Progress", from: "todo", to: "in_progress",
    created_at: "2026-08-02T09:12:00Z",
  },
  {
    id: "a2", kind: "assignment", actor: "you",
    summary: "assigned atlas", created_at: "2026-08-02T09:05:00Z",
  },
  {
    id: "a1", kind: "created", actor: "you",
    summary: "created this work item", created_at: "2026-08-01T09:00:00Z",
  },
];
