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
