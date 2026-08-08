import { useState } from "react";

import { DataSourceBadge } from "../../components/DataSourceBadge";
import { Toggle } from "../../components/ui/Toggle";
import { findMcpServer } from "../../mocks/unbacked/mcp.servers";

const SCOPE_LABEL = { all: "All tools", read_only: "Read-only", none: "No access" } as const;

/** MCP Server detail — fixtures throughout, and the toggles are local only.
 *
 * Nothing here persists because there is no `McpServer` to persist to. The
 * controls exist so their shape is settled; the screen says plainly that a
 * change is not saved rather than letting a flipped switch imply otherwise. */
export function McpDetailScreen({ name }: { name: string | undefined }) {
  const server = findMcpServer(name);
  const [tools, setTools] = useState(() => server?.tools ?? []);
  const [touched, setTouched] = useState(false);

  if (!server) {
    return <p className="p-6 text-12 text-text-3">There is no MCP server called {name}.</p>;
  }

  const toggle = (toolName: string) => {
    setTouched(true);
    setTools((current) =>
      current.map((tool) =>
        tool.name === toolName ? { ...tool, enabled: !tool.enabled } : tool,
      ),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-[17px] font-semibold text-text-1">{server.name}</h1>
        <DataSourceBadge screen="mcpServerDetail" />
      </div>

      <div className="flex gap-6 font-mono text-10 text-text-5">
        <span>
          TOOLS EXPOSED{" "}
          <span data-testid="tools-exposed" className="text-text-2">
            {tools.length}
          </span>
        </span>
        <span>
          AGENTS WITH ACCESS <span className="text-text-2">{server.access.length}</span>
        </span>
        <span>
          CALLS TODAY <span className="text-text-2">{server.calls_today}</span>
        </span>
        <span>
          P50 <span className="text-text-2">{server.p50_ms}ms</span>
        </span>
      </div>

      <section>
        <h2 className="font-mono text-9-5 tracking-[0.07em] text-text-6">CONNECTION</h2>
        <dl className="mt-1 text-11-5 text-text-3">
          <div className="flex gap-2">
            <dt className="w-[80px] text-text-5">Transport</dt>
            <dd>{server.transport}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[80px] text-text-5">Auth</dt>
            <dd>
              {server.auth_secret ? (
                <>
                  <span className="font-mono">{server.auth_secret}</span>{" "}
                  <span className="text-agent-working">from Secrets</span>
                </>
              ) : (
                "None"
              )}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-[80px] text-text-5">Command</dt>
            <dd className="font-mono text-10-5">{server.command}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="font-mono text-9-5 tracking-[0.07em] text-text-6">TOOLS</h2>
        {touched && (
          <p className="mt-1 text-11 text-badge-review-text">
            Changed here only — not saved, because MCP servers have no backend yet.
          </p>
        )}
        <ul className="mt-1 flex flex-col gap-1">
          {tools.map((tool) => (
            <li key={tool.name} className="flex items-center gap-2 text-11-5 text-text-3">
              <Toggle
                checked={tool.enabled}
                onChange={() => toggle(tool.name)}
                label={tool.name}
              />
              <span className="font-mono">{tool.name}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-mono text-9-5 tracking-[0.07em] text-text-6">AGENT ACCESS</h2>
        <ul className="mt-1 flex flex-col gap-1">
          {server.access.map((entry) => (
            <li key={entry.agent_name} className="flex gap-2 text-11-5 text-text-3">
              <span className="w-[80px]">{entry.agent_name}</span>
              <span className="text-text-5">{SCOPE_LABEL[entry.scope]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-mono text-9-5 tracking-[0.07em] text-text-6">RECENT CALLS</h2>
        <ul className="mt-1 flex flex-col gap-1 font-mono text-10-5">
          {server.recent_calls.map((call) => (
            <li
              key={call.id}
              data-testid={`call-${call.id}`}
              className={`flex gap-3 ${call.denied ? "text-[#c25b5b]" : "text-text-4"}`}
            >
              <span>{call.at}</span>
              <span>{call.agent_name}</span>
              <span>{call.tool}</span>
              <span className="truncate">{call.argument}</span>
              <span>{call.latency_ms}ms</span>
              {call.denied && <span>DENIED</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
