import { Outlet } from "react-router-dom";

/** The outer shell every route renders inside.
 *
 * A skeleton at this point: Task 4 builds the Sidebar, Topbar and ChatPanel to
 * the handoff's dimensions (sidebar 214px, topbar 44px, chat panel 292px / 34px
 * collapsed). The inherited versions of those were welded to the source
 * project's API and did not come across — see the Task 1 commit body.
 */
export function AppShell() {
  return (
    <div className="flex h-full bg-bg-base text-text-1">
      <main className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
