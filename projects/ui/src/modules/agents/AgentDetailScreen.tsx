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
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-[17px] font-semibold text-text-1">{agent.name}</h1>
        <DataSourceBadge screen="agentDetail" />
        <span className="ml-auto flex items-center gap-2">
          <span className="text-11 text-text-5">
            Read-only — no write endpoint for agent folders yet.
          </span>
          <Button disabled>Save to disk</Button>
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-9-5 tracking-[0.07em] text-text-6">AGENT.md</span>
        <textarea
          readOnly
          value={agent.instructions}
          rows={12}
          className="rounded-6 border border-border bg-bg-inset p-3 font-mono text-12 leading-[1.55] text-text-2"
        />
      </label>

      <label className="flex max-w-[280px] flex-col gap-1">
        <span className="font-mono text-9-5 tracking-[0.07em] text-text-6">
          MODEL · config.yaml
        </span>
        <input
          readOnly
          value={agent.model}
          className="h-8 rounded-5 border border-border bg-bg-input px-2 font-mono text-12 text-text-2"
        />
      </label>

      <div>
        <span className="font-mono text-9-5 tracking-[0.07em] text-text-6">SKILLS</span>
        <ul className="mt-1 flex flex-col gap-1">
          {agent.skills.map((skill) => (
            <li key={skill} className="text-11-5 text-text-3">
              {skill}/SKILL.md
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
