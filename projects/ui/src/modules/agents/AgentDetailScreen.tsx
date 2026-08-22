import { Avatar } from "../../components/ui/Avatar";
import { DataSourceBadge } from "../../components/DataSourceBadge";
import { Button } from "../../components/ui/Button";
import { useAgents } from "../../lib/api/hooks";

/** Agent detail.
 *
 * Reads are live; **every write is unbacked**. The design shows an editable
 * AGENT.md, a rename that renames the folder, and a model picker — none of which
 * have an endpoint. The controls are shown so the shape is settled, and disabled
 * with the reason: a write that appears to work and silently does nothing is
 * worse than a disabled control with an explanation.
 */
export function AgentDetailScreen({ name }: { name: string | undefined }) {
  const { data, isPending, isError } = useAgents();

  if (isPending) return <p className="p-6 text-12 text-text-4">Loading the agent…</p>;
  if (isError) {
    return (
      <p role="alert" className="p-6 text-12 text-badge-action-text">
        Could not load agents.
      </p>
    );
  }

  const agent = data.results.find((item) => item.name === name);
  if (!agent) {
    return <p className="p-6 text-12 text-text-3">There is no agent folder called {name}.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border-subtle bg-bg-strip px-6 py-3">
        {/* §C2: the identity strip opens with a 38px tile. It was the one
            element of the strip never built. */}
        <Avatar initials={agent.name.slice(0, 2).toUpperCase()} variant="agent" size={38} />
        <h1 className="text-[17px] font-semibold text-text-1">{agent.name}</h1>
        <DataSourceBadge screen="agentDetail" />
        <span className="ml-auto flex items-center gap-2">
          <span className="text-11 text-text-5">
            Read-only — no write endpoint for agent folders yet.
          </span>
          <Button disabled>Save to disk</Button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-auto p-6">
          <span className="font-mono text-9-5 tracking-[0.07em] text-text-6">
            AGENT.md · ~/.roster/agents/{agent.name}/AGENT.md
          </span>
          <textarea
            readOnly
            aria-label="AGENT.md"
            value={agent.instructions}
            rows={16}
            className="rounded-6 border border-border bg-bg-surface-2 p-3 font-mono text-12 leading-[1.55] text-text-2"
          />
          <span className="text-11 text-text-5">
            Changes would write straight to the file on disk — once there is an endpoint.
          </span>
        </div>

        {/* Handoff §C2 — the 372px rail. */}
        <aside
          data-testid="agent-detail-rail"
          className="w-[372px] shrink-0 overflow-auto border-l border-border-subtle"
        >
          <section className="border-b border-border-subtle px-4 py-3">
            <h2 className="font-mono text-9-5 tracking-[0.07em] text-text-7">CONFIG.YAML</h2>
            <label className="mt-2 flex flex-col gap-1">
              <span className="text-11 text-text-5">MODEL</span>
              <input
                readOnly
                aria-label="Model"
                // Empty with a placeholder, not pre-filled with roster's
                // fallback: a readOnly field showing `claude-opus-5` reads as a
                // value the operator set, and for a `tool: codex` agent whose
                // config.yaml names no model, nothing set it.
                value={agent.model ?? ""}
                placeholder={`chosen by ${agent.tool}`}
                className="h-8 rounded-5 border border-border bg-bg-input px-2 font-mono text-12 text-text-2"
              />
            </label>
            <dl className="mt-2 flex flex-col gap-1 text-11">
              <div className="flex gap-2">
                <dt className="w-[110px] text-text-5">TOOL</dt>
                <dd className="font-mono text-text-3">{agent.tool}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[110px] text-text-5">MAX TOKENS / RUN</dt>
                <dd className="font-mono text-text-3">{agent.token_limit.toLocaleString()}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[110px] text-text-5">TEMPERATURE</dt>
                <dd className="font-mono text-text-3">{agent.temperature ?? "—"}</dd>
              </div>
            </dl>
          </section>

          <section className="border-b border-border-subtle px-4 py-3">
            <h2 className="font-mono text-9-5 tracking-[0.07em] text-text-7">SKILLS</h2>
            {agent.skills.length === 0 ? (
              <p className="mt-2 text-11 text-text-5">No skills folder.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {agent.skills.map((skill) => (
                  <li key={skill} className="font-mono text-11 text-text-3">
                    {skill}/SKILL.md
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="px-4 py-3">
            <h2 className="font-mono text-9-5 tracking-[0.07em] text-text-7">MCP SERVERS</h2>
            <p className="mt-2 text-11 text-text-5">
              Per-agent MCP access has no backend yet — see the MCP screens.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
