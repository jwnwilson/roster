import { useState } from "react";

import { DataSourceBadge } from "../../components/DataSourceBadge";
import { secrets } from "../../mocks/unbacked/secrets.list";

/** Settings.
 *
 * Four sections only. Agents, Models and Tools were removed in this design
 * revision — agents are configured from their folder on disk and tools from
 * their MCP server, so a settings page for them would be a second place to
 * change something roster does not own.
 */
const SECTIONS = [
  { group: "WORKSPACE", items: ["General"] },
  { group: "BILLING", items: ["Budgets & Limits", "Usage History"] },
  { group: "INTEGRATIONS", items: ["GitHub"] },
  { group: "SECURITY", items: ["Secrets"] },
] as const;

export function SettingsScreen() {
  const [active, setActive] = useState<string>("Secrets");

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="w-[176px] shrink-0 bg-bg-surface-2 px-[10px] py-4">
        {SECTIONS.map((section) => (
          <div key={section.group} className="mb-3">
            <span className="font-mono text-9-5 tracking-[0.08em] text-text-7">
              {section.group}
            </span>
            <ul className="mt-1">
              {section.items.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    onClick={() => setActive(item)}
                    className={`w-full rounded-5 px-2 py-[5px] text-left text-12 ${
                      active === item
                        ? "bg-accent-bg font-medium text-accent-text"
                        : "text-text-4"
                    }`}
                  >
                    {item}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="min-w-0 flex-1 p-6">
        {active === "Secrets" ? (
          <>
            <div className="flex items-center gap-2">
              <h1 className="text-15 font-semibold text-text-1">Secrets</h1>
              <DataSourceBadge screen="settingsSecrets" />
            </div>
            <p className="mt-1 text-11-5 text-text-4">
              MCP servers reference these by name. Roster never displays a secret&rsquo;s value.
            </p>
            <table className="mt-4 w-full text-left">
              <thead>
                <tr className="font-mono text-9-5 tracking-[0.07em] text-text-7">
                  <th className="py-2 font-normal">NAME</th>
                  <th className="py-2 font-normal">USED BY</th>
                  <th className="py-2 font-normal">LAST USED</th>
                </tr>
              </thead>
              <tbody>
                {secrets.map((secret) => (
                  <tr key={secret.name} className="border-t border-overlay-05">
                    <td className="py-2 font-mono text-11-5 text-text-2">{secret.name}</td>
                    <td className="py-2 text-11-5 text-text-4">{secret.scope}</td>
                    <td className="py-2 font-mono text-10-5 text-text-5">
                      {secret.last_used_at ?? "never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-12 text-text-3">{active} is not built yet.</p>
        )}
      </div>
    </div>
  );
}
