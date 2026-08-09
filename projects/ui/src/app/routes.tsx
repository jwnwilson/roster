import { Navigate } from "react-router-dom";
import type { RouteObject } from "react-router-dom";

import { AppShell } from "./AppShell";
import { BoardScreen } from "../modules/board/BoardScreen";
import { AgentDetailRoute } from "../modules/agents/AgentDetailRoute";
import { AgentsScreen } from "../modules/agents/AgentsScreen";
import { DashboardScreen } from "../modules/dashboard/DashboardScreen";
import { DetailRoute } from "../modules/detail/DetailRoute";
import { McpDetailRoute } from "../modules/mcp/McpDetailRoute";
import { McpServersScreen } from "../modules/mcp/McpServersScreen";
import { SettingsScreen } from "../modules/settings/SettingsScreen";
import { ThreadsScreen } from "../modules/threads/ThreadsScreen";

export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/projects?view=board" replace /> },
      { path: "dashboard", element: <DashboardScreen /> },
      { path: "threads", element: <ThreadsScreen /> },
      { path: "agents", element: <AgentsScreen /> },
      { path: "agents/:name", element: <AgentDetailRoute /> },
      { path: "mcp", element: <McpServersScreen /> },
      { path: "mcp/:name", element: <McpDetailRoute /> },
      { path: "projects", element: <BoardScreen /> },
      { path: "projects/:projectId/items/:itemId", element: <DetailRoute /> },
      { path: "settings/secrets", element: <SettingsScreen /> },
    ],
  },
];
