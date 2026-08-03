import { useState } from "react";
import { Link } from "react-router-dom";

import { DataSourceBadge } from "../../components/DataSourceBadge";
import { Avatar } from "../../components/ui/Avatar";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useAgents } from "../../lib/api/hooks";
import type { AgentStatus } from "../../lib/api/types";

type Filter = "all" | AgentStatus;

const FILTERS: Filter[] = ["all", "working", "active", "disabled"];
const LABEL: Record<Filter, string> = {
  all: "All",
  working: "Working",
  active: "Active",
  disabled: "Disabled",
};

/** Agents — read-only, because agents are folders on disk and roster never
 *  stores their configuration (spec §4). `working` is live: an in-flight turn is
 *  the only thing that produces it. */
export function AgentsScreen() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, isPending, isError } = useAgents();

  if (isPending) return <p className="p-6 text-12 text-text-4">Loading agents…</p>;
  if (isError) {
    return (
      <p role="alert" className="p-6 text-12 text-badge-action-text">
        Could not load agents.
      </p>
    );
  }

  const agents = data.results.filter((item) => filter === "all" || item.status === filter);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-6 py-3">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-5 border px-[9px] py-1 text-11 ${
              filter === value
                ? "border-accent-border bg-accent-bg text-accent-text"
                : "border-border-strong text-text-3"
            }`}
          >
            {LABEL[value]}
          </button>
        ))}
        <span className="ml-auto">
          <DataSourceBadge screen="agents" />
        </span>
      </div>

      <p className="bg-[#0b0d10] px-6 py-2 text-11 text-text-4">
        <span className="mr-2 font-mono text-9-5 tracking-[0.07em] text-text-6">AGENT FOLDER</span>
        Instructions, skills and model are read from disk — roster never stores agent config itself.
      </p>

      {data.results.length === 0 ? (
        <p className="p-6 text-12 text-text-3">No agent folders found.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="font-mono text-9-5 tracking-[0.07em] text-text-7">
              <th className="px-6 py-2 font-normal">AGENT · PATH</th>
              <th className="py-2 font-normal">STATUS</th>
              <th className="py-2 font-normal">MODEL · config.yaml</th>
              <th className="py-2 font-normal">SKILLS</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((item) => (
              <tr key={item.name} className="border-t border-[rgba(255,255,255,0.03)]">
                <td className="px-6 py-3">
                  <Link to={`/agents/${item.name}`} className="flex items-center gap-2">
                    <Avatar
                      initials={item.name.slice(0, 2).toUpperCase()}
                      variant="agent"
                      size={26}
                    />
                    <span>
                      <span className="block text-12-5 font-semibold text-text-1">{item.name}</span>
                      {item.problem && (
                        <span className="block text-10 text-badge-action-text">{item.problem}</span>
                      )}
                    </span>
                  </Link>
                </td>
                <td className="py-3">
                  <StatusBadge kind={item.status} />
                </td>
                <td className="py-3 font-mono text-10-5 text-text-4">{item.model}</td>
                <td className="py-3 text-11 text-text-3">{item.skills.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
