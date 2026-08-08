import { DataSourceBadge } from "../../components/DataSourceBadge";
import { tokenUsage } from "../../mocks/unbacked/tokens.usage";
import { workItemActivity } from "../../mocks/unbacked/workItems.activity";
import { ActiveAgentsPanel } from "./ActiveAgentsPanel";

/** Dashboard.
 *
 * Mostly sample data, and it says so. Every card and chart below depends on
 * `tokens.usage`, which no entity carries — the only true panel is the agents
 * one. Each panel owns its own loading and error state so a single failing query
 * cannot blank the screen.
 */
export function DashboardScreen() {
  const pct = Math.round((tokenUsage.budget_used / tokenUsage.budget_limit) * 100);
  const peak = Math.max(...tokenUsage.today);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
      <section data-testid="metric-cards" className="grid grid-cols-4 gap-3">
        {[
          { label: "TOKENS USED", value: tokenUsage.budget_used.toLocaleString() },
          { label: "BUDGET", value: `${pct}%` },
          { label: "WORK ITEMS TOUCHED", value: "7" },
          { label: "SPEND TODAY", value: "$12.40" },
        ].map((card, index) => (
          <div key={card.label} className="rounded-8 border border-border bg-bg-surface p-4">
            <div className="flex items-center">
              <span className="font-mono text-9-5 tracking-[0.07em] text-text-6">{card.label}</span>
              {index === 0 && (
                <span className="ml-auto">
                  <DataSourceBadge screen="dashboard" />
                </span>
              )}
            </div>
            <div className="mt-1 text-[30px] font-semibold text-text-1">{card.value}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-2 gap-4">
        <ActiveAgentsPanel />

        <div className="flex flex-col gap-4">
          <section
            data-testid="token-chart"
            className="rounded-8 border border-border bg-bg-surface p-4"
          >
            <div className="flex items-center">
              <h2 className="text-12-5 font-semibold text-text-2">Tokens this week</h2>
              <span className="ml-auto">
                <DataSourceBadge screen="dashboard" />
              </span>
            </div>
            <div className="mt-3 flex h-[80px] items-end gap-1">
              {tokenUsage.today.map((value, index) => (
                <div
                  key={index}
                  className={`flex-1 rounded-t-[2px] ${
                    index === tokenUsage.today.length - 1 ? "bg-accent" : "bg-[#2a2d36]"
                  }`}
                  style={{ height: `${(value / peak) * 100}%` }}
                />
              ))}
            </div>
          </section>

          <section
            data-testid="activity-feed"
            className="flex-1 rounded-8 border border-border bg-bg-surface p-4"
          >
            <div className="flex items-center">
              <h2 className="text-12-5 font-semibold text-text-2">Recent activity</h2>
              <span className="ml-auto">
                <DataSourceBadge screen="dashboard" />
              </span>
            </div>
            <ul className="mt-2 flex flex-col gap-2">
              {workItemActivity.map((event) => (
                <li key={event.id} className="flex items-center gap-2 text-11-5 text-text-3">
                  <span className="size-[5px] rounded-full bg-accent" />
                  <span>
                    <span className="text-text-2">{event.actor}</span> {event.summary}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
