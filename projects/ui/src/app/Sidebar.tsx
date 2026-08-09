import { Link, NavLink, useSearchParams } from "react-router-dom";

import { DataSourceBadge } from "../components/DataSourceBadge";
import {
  AgentsIcon,
  DashboardIcon,
  FolderIcon,
  GitRepoIcon,
  McpIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ThreadsIcon,
} from "../components/ui/icons";
import { useProjects } from "../lib/api/hooks";
import { useCreateModal } from "../modules/create/useCreateModal";
import { tokenUsage } from "../mocks/unbacked/tokens.usage";

const NAV = [
  { to: "/dashboard", label: "Dashboard", Icon: DashboardIcon },
  { to: "/threads", label: "Threads", Icon: ThreadsIcon },
  { to: "/agents", label: "Agents", Icon: AgentsIcon },
  { to: "/mcp", label: "MCP Servers", Icon: McpIcon },
] as const;

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    "flex items-center gap-[7px] rounded-5 px-[7px] py-[5px] text-11",
    isActive ? "bg-accent-bg font-medium text-accent-text" : "text-text-4",
  ].join(" ");

export function Sidebar() {
  const { openProject } = useCreateModal();
  const [searchParams] = useSearchParams();
  const selectedProject = searchParams.get("project");
  const { data } = useProjects();
  const projects = data?.results ?? [];
  const pct = Math.round((tokenUsage.budget_used / tokenUsage.budget_limit) * 100);

  return (
    <nav className="flex w-[214px] shrink-0 flex-col border-r border-border-subtle bg-bg-sidebar">
      <div className="flex h-[48px] items-center gap-2 px-[9px]">
        <span className="flex size-[24px] items-center justify-center rounded-full border-[1.5px] border-overlay-13 bg-bg-avatar font-mono text-9-5 font-bold text-text-2">
          JW
        </span>
        <span className="text-12-5 font-semibold text-text-1">Roster</span>
      </div>

      <div className="px-[9px]">
        <div className="flex h-[28px] items-center gap-2 rounded-5 border border-border bg-bg-input px-2">
          <SearchIcon size={11} className="text-text-7" />
          <span className="text-11-5 text-text-7">Search</span>
          <span className="ml-auto font-mono text-9 text-text-7">⌘K</span>
        </div>
      </div>

      <ul className="mt-2 flex flex-col gap-[2px] px-[9px]">
        {NAV.map(({ to, label, Icon }) => (
          <li key={to}>
            <NavLink to={to} className={navClass}>
              <Icon size={13} />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="pt-[14px]">
        <div className="flex items-center px-[9px] pb-1">
          <span className="font-mono text-9-5 tracking-[0.08em] text-text-3">PROJECTS</span>
          <button
            type="button"
            aria-label="New project"
            onClick={openProject}
            className="ml-auto flex size-[17px] items-center justify-center rounded-4 border border-border-strong bg-overlay-05 text-text-3"
          >
            <PlusIcon size={9} />
          </button>
        </div>
        <ul className="flex flex-col px-[9px]">
          {projects.map((project) => (
            <li key={project.id}>
              {/* Not NavLink: it computes isActive from the pathname alone and
                  ignores the query, so every project rendered as active at once
                  — and several aria-current="page" in one nav is a defect in its
                  own right. */}
              <Link
                to={`/projects?project=${project.id}`}
                aria-label={project.name}
                aria-current={selectedProject === project.id ? "page" : undefined}
                className={navClass({ isActive: selectedProject === project.id })}
              >
                {project.source.kind === "git" ? (
                  <GitRepoIcon size={11} data-glyph="git" />
                ) : (
                  <FolderIcon size={11} data-glyph="folder" />
                )}
                <span className="truncate text-11-5">{project.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto border-t border-overlay-05 px-[9px] py-2">
        <NavLink to="/settings/secrets" className={navClass}>
          <SettingsIcon size={13} />
          Settings
        </NavLink>
        <div data-testid="token-budget" data-source="unbacked" className="mt-2">
          <div className="flex items-center justify-between font-mono text-9-5">
            <span className="text-text-6">TOKEN BUDGET</span>
            <span className="text-text-3">{pct}%</span>
          </div>
          <div className="mt-1 h-[3px] rounded-[1px] bg-bg-track">
            <div className="h-full rounded-[1px] bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex justify-end">
            <DataSourceBadge screen="dashboard" />
          </div>
        </div>
      </div>
    </nav>
  );
}
