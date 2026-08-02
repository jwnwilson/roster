import { Outlet, useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";

import { ChatPanel } from "./ChatPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { Sidebar } from "./Sidebar";

export interface AppShellProps {
  /** Test seam: routes render through `Outlet` in the app itself. */
  children?: ReactNode;
}

/** The outer shell every route renders inside, to the handoff's dimensions:
 *  sidebar 214px, chat panel 292px open / 34px collapsed. */
export function AppShell({ children }: AppShellProps) {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project") ?? undefined;

  return (
    <div className="flex h-full bg-bg-base text-text-1">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <ErrorBoundary>{children ?? <Outlet />}</ErrorBoundary>
      </main>
      <ChatPanel projectId={projectId} />
    </div>
  );
}
