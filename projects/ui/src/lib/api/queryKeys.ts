/** React Query key factories.
 *
 * Task 3 rebuilds these against roster's own endpoints; what remains here is the
 * subset whose resource actually exists. Keys for the source project's endpoints
 * (board, dashboard, budget, agent-definitions) were removed rather than kept
 * against resources roster does not have.
 */
export const queryKeys = {
  projects: () => ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  workItems: (projectId: string) => ["work-items", projectId] as const,
  agents: () => ["agents"] as const,
  threads: () => ["threads"] as const,
  thread: (id: string) => ["threads", id] as const,
  threadMessages: (id: string) => ["threads", id, "messages"] as const,
  memory: (projectId: string) => ["projects", projectId, "memory"] as const,
};
