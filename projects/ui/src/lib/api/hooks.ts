import { useQuery } from "@tanstack/react-query";

import { listAgents } from "./agents";
import { listProjects } from "./projects";
import { queryKeys } from "./queryKeys";
import { listMessages, listThreads } from "./threads";
import type { ThreadFilters } from "./threads";
import { listWorkItems } from "./workItems";

export function useProjects() {
  return useQuery({ queryKey: queryKeys.projects(), queryFn: listProjects });
}

export function useWorkItems(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workItems(projectId ?? "none"),
    queryFn: () => listWorkItems(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useAgents() {
  return useQuery({ queryKey: queryKeys.agents(), queryFn: listAgents });
}

export function useThreads(filters: ThreadFilters = {}) {
  return useQuery({
    queryKey: [...queryKeys.threads(), filters],
    queryFn: () => listThreads(filters),
  });
}

export function useThreadMessages(threadId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.threadMessages(threadId ?? "none"),
    queryFn: () => listMessages(threadId!),
    enabled: Boolean(threadId),
  });
}

/** There is no `GET /work-items/{id}` — the detail screen selects out of the
 *  project's listing. Registered as `workItems.readOne` (unbacked) so the
 *  compromise is visible rather than folklore. */
export function useWorkItem(projectId: string | undefined, itemId: string | undefined) {
  const query = useWorkItems(projectId);
  return {
    ...query,
    data: query.data?.results.find((item) => item.id === itemId),
    missing: query.isSuccess && !query.data.results.some((item) => item.id === itemId),
  };
}
