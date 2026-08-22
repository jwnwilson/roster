import { useState } from "react";
import { Link } from "react-router-dom";

import { DataSourceBadge } from "../../components/DataSourceBadge";
import { mcpServers } from "../../mocks/unbacked/mcp.servers";
import type { McpStatus } from "../../mocks/unbacked/mcp.servers";

type Filter = "all" | McpStatus;

const FILTERS: Filter[] = ["all", "connected", "auth_expired", "disabled"];
const LABEL: Record<Filter, string> = {
  all: "All",
  connected: "Connected",
  auth_expired: "Needs attention",
  disabled: "Disabled",
};
const STATUS_TEXT: Record<McpStatus, string> = {
  connected: "Connected",
  auth_expired: "Auth expired",
  disabled: "Disabled",
};
const STATUS_COLOUR: Record<McpStatus, string> = {
  connected: "text-agent-working",
  auth_expired: "text-attention",
  disabled: "text-agent-disabled",
};

/** MCP Servers — entirely fixtures. There is no `McpServer` persistence, so this
 *  settles the screen's shape rather than showing anything true. */
export function McpServersScreen() {
  const [filter, setFilter] = useState<Filter>("all");
  const servers = mcpServers.filter((server) => filter === "all" || server.status === filter);
  const needsAttention = mcpServers.filter((server) => server.attention !== null);

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
          <DataSourceBadge screen="mcpServers" />
        </span>
      </div>

      {needsAttention.length > 0 && (
        <div className="mx-6 mb-3 rounded-6 border border-badge-review-border bg-badge-review-bg px-3 py-2">
          <span className="font-mono text-9-5 tracking-[0.07em] text-badge-review-text">
            {needsAttention.length} SERVER NEEDS ATTENTION
          </span>
          {needsAttention.map((server) => (
            <p key={server.name} className="mt-1 text-11-5 text-text-3">
              <strong className="text-text-2">{server.name}</strong> — {server.attention}
            </p>
          ))}
        </div>
      )}

      {servers.length === 0 && (
        <p className="px-6 py-4 text-12 text-text-3">No servers match that filter.</p>
      )}

      <table className="w-full table-fixed text-left">
        {/* §Screen K fixes these widths (300 128 1fr 92 96 104 92). Without
            table-fixed nothing lands where the design puts it. USED BY and P50
            are omitted: this whole screen is fixture-backed and badged as such,
            and two more columns of invented numbers would deepen the fiction
            rather than the fidelity. */}
        <colgroup>
          <col className="w-[300px]" />
          <col className="w-[128px]" />
          <col />
          <col className="w-[92px]" />
          <col className="w-[104px]" />
        </colgroup>
        <thead>
          <tr className="font-mono text-9-5 tracking-[0.07em] text-text-7">
            <th className="px-6 py-2 font-normal">SERVER · ENDPOINT</th>
            <th className="py-2 font-normal">STATUS</th>
            <th className="py-2 font-normal">TRANSPORT</th>
            <th className="py-2 font-normal">TOOLS</th>
            <th className="py-2 font-normal">CALLS TODAY</th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => (
            <tr key={server.name} className="border-t border-overlay-05">
              <td className="px-6 py-3">
                <Link to={`/mcp/${server.name}`}>
                  <span className="block text-12-5 font-semibold text-text-1">{server.name}</span>
                  <span className="block font-mono text-10 text-text-5">{server.endpoint}</span>
                </Link>
              </td>
              <td className={`py-3 font-mono text-10-5 ${STATUS_COLOUR[server.status]}`}>
                {STATUS_TEXT[server.status]}
              </td>
              <td className="py-3 font-mono text-10-5 text-text-4">{server.transport}</td>
              <td data-testid="tool-count" className="py-3 text-11 text-text-3">
                {server.tools.length}
              </td>
              <td className="py-3 font-mono text-10-5 text-text-4">{server.calls_today}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
