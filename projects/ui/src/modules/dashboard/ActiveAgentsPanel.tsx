import { Avatar } from "../../components/ui/Avatar";
import { useAgents } from "../../lib/api/hooks";

/** The one live panel on this screen. `working` comes from an in-flight turn, so
 *  this reflects what agents are actually doing right now.
 *
 *  Named "active agents", not "running": there is no run concept (spec §6). */
export function ActiveAgentsPanel() {
  const { data, isPending, isError } = useAgents();
  const working = data?.results.filter((item) => item.status === "working");

  return (
    <section
      data-testid="active-agents"
      className="rounded-8 border border-border bg-bg-surface p-4"
    >
      <h2 className="flex items-center gap-2 text-12-5 font-semibold text-text-2">
        Agents working
        {working && working.length > 0 && (
          <span className="font-mono text-10-5 text-agent-working">{working.length}</span>
        )}
      </h2>

      {isPending && <p className="mt-2 text-11-5 text-text-4">Loading agents…</p>}

      {isError && (
        <p role="alert" className="mt-2 text-11-5 text-badge-action-text">
          Could not load agents.
        </p>
      )}

      {data &&
        (() => {
          if (working === undefined || working.length === 0) {
            // Honest: the alternative is inventing activity on the one panel
            // that is supposed to be true.
            return <p className="mt-2 text-11-5 text-text-4">No agent is working right now.</p>;
          }
          return (
            <ul className="mt-2 flex flex-col gap-2">
              {working.map((item) => (
                <li key={item.name} className="flex items-center gap-2">
                  <Avatar
                    initials={item.name.slice(0, 2).toUpperCase()}
                    variant="agent"
                    size={20}
                  />
                  <span className="text-11-5 text-text-2">{item.name}</span>
                  <span className="ml-auto font-mono text-10 text-text-5">{item.model}</span>
                </li>
              ))}
            </ul>
          );
        })()}
    </section>
  );
}
