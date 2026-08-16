import { DataSourceBadge } from "../../components/DataSourceBadge";
import { PulseDot } from "../../components/ui/PulseDot";
import { useAgents } from "../../lib/api/hooks";
import { tokenUsage } from "../../mocks/unbacked/tokens.usage";

/** Handoff §Screen B — the 76px ribbon above the board.
 *
 * `working` is live: an in-flight turn is the only thing that produces it. The
 * per-agent progress bar is not — no entity carries progress — so it is drawn
 * from a fixture and the ribbon is badged.
 *
 * Disabled agents are omitted rather than shown idle: a broken folder cannot be
 * taking a turn, and listing it here would imply it is merely between jobs.
 */
export function LiveAgentsRibbon() {
  const { data, isPending, isError } = useAgents();

  if (isPending || isError) return null;

  const agents = data.results.filter((item) => item.status !== "disabled");

  return (
    <div
      data-testid="live-agents-ribbon"
      className="flex h-[76px] shrink-0 items-center gap-3 overflow-x-auto border-b border-border-subtle bg-bg-column-header px-[14px]"
    >
      <span className="shrink-0 font-mono text-9-5 tracking-[0.07em] text-text-faint-2">
        LIVE AGENTS
      </span>

      {agents.length === 0 ? (
        <span className="text-11-5 text-text-4">No agents configured.</span>
      ) : (
        agents.map((item) => {
          const working = item.status === "working";
          return (
            <div
              key={item.name}
              data-testid={`agent-chip-${item.name}`}
              data-state={working ? "working" : "idle"}
              className={`flex shrink-0 flex-col gap-1 rounded-7 border px-[11px] py-[9px] ${
                working
                  ? "min-w-[170px] border-border bg-bg-surface"
                  : "min-w-[132px] border-overlay-05 bg-bg-base"
              }`}
            >
              <div className="flex items-center gap-2">
                {working ? (
                  <PulseDot size={6} />
                ) : (
                  <span className="size-[6px] rounded-full border border-stroke-idle" />
                )}
                <span
                  className={`flex-1 text-11 ${working ? "font-semibold text-text-2" : "text-text-6"}`}
                >
                  {item.name}
                </span>
                <span
                  className={`font-mono text-[8.5px] ${working ? "text-accent" : "text-text-7"}`}
                >
                  {working ? "RUN" : "IDLE"}
                </span>
              </div>
              <span className="truncate text-10 text-agent-disabled">
                {working ? item.model : "Awaiting task"}
              </span>
              {working && (
                <div className="h-[2px] rounded-[1px] bg-bg-overlay">
                  <div
                    className="h-full rounded-[1px] bg-accent"
                    style={{ width: `${(tokenUsage.budget_used / tokenUsage.budget_limit) * 100}%` }}
                  />
                </div>
              )}
            </div>
          );
        })
      )}

      <span className="ml-auto shrink-0">
        <DataSourceBadge screen="board" />
      </span>
    </div>
  );
}
