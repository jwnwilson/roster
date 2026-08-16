import { apiList, apiPatch, apiPost } from "./client";
import type { Priority, WorkItem, WorkItemStatus, WorkItemType } from "./types";

export type NewWorkItem = {
  project_id: string;
  type: WorkItemType;
  title: string;
  /** The column a board + button belongs to. Omitted, the API starts it in the backlog. */
  status?: WorkItemStatus;
  priority?: Priority;
  epic_id?: string;
  feature_id?: string;
  spec?: string;
  agent_name?: string;
};

export type WorkItemPatch = Partial<{
  title: string;
  status: WorkItemStatus;
  priority: Priority;
  spec: string;
  agent_name: string;
}>;

/** `project_id` is required — the API has no all-projects listing. */
export const listWorkItems = (projectId: string) =>
  apiList<WorkItem>("/work-items", { project_id: projectId });

export const createWorkItem = (item: NewWorkItem) => apiPost<WorkItem>("/work-items", item);

export const updateWorkItem = (id: string, patch: WorkItemPatch) =>
  apiPatch<WorkItem>(`/work-items/${id}`, patch);
