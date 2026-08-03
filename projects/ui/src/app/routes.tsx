import { Navigate } from "react-router-dom";
import type { RouteObject } from "react-router-dom";

import { AppShell } from "./AppShell";
import { BoardRoute } from "../modules/board/BoardRoute";
import { AgentDetailRoute } from "../modules/agents/AgentDetailRoute";
import { AgentsScreen } from "../modules/agents/AgentsScreen";
import { DetailRoute } from "../modules/detail/DetailRoute";
import { ThreadsScreen } from "../modules/threads/ThreadsScreen";

/** Placeholder until the task that owns this screen builds it.
 *
 * Deliberately visible rather than a blank div: a route that renders nothing is
 * indistinguishable from a route that is broken. */
function NotBuiltYet({ screen }: { screen: string }) {
  return (
    <div role="status" className="p-6 text-text-3 text-[12px]">
      {screen} is not built yet.
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/projects?view=board" replace /> },
      { path: "dashboard", element: <NotBuiltYet screen="Dashboard" /> },
      { path: "threads", element: <ThreadsScreen /> },
      { path: "agents", element: <AgentsScreen /> },
      { path: "agents/:name", element: <AgentDetailRoute /> },
      { path: "mcp", element: <NotBuiltYet screen="MCP servers" /> },
      { path: "mcp/:name", element: <NotBuiltYet screen="MCP server detail" /> },
      { path: "projects", element: <BoardRoute /> },
      { path: "projects/:projectId/items/:itemId", element: <DetailRoute /> },
      { path: "settings/secrets", element: <NotBuiltYet screen="Settings" /> },
    ],
  },
];
