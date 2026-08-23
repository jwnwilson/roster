import type { RegistryEntry } from '@shared/types'
import { ScreenHeader, SectionLabel, Segmented } from '@/components/primitives'
import { useRoster, type McpTab } from '@/state/store'

const TABS = [
  { value: 'installed' as const, label: 'Installed' },
  { value: 'registry' as const, label: 'Registry' },
]

/**
 * A static catalogue of well-known servers. Installing from here writes into
 * mcp.json; nothing is fetched from the network.
 */
const REGISTRY: RegistryEntry[] = [
  { category: 'Code & repos', name: 'github', description: 'Issues, pull requests, and file contents across your repositories.', author: 'modelcontextprotocol' },
  { category: 'Code & repos', name: 'gitlab', description: 'Merge requests, pipelines, and repository browsing.', author: 'community' },
  { category: 'Code & repos', name: 'sentry', description: 'Read error events and stack traces from your projects.', author: 'sentry' },
  { category: 'Data', name: 'postgres', description: 'Query a Postgres database with a read-only role.', author: 'modelcontextprotocol' },
  { category: 'Data', name: 'sqlite', description: 'Open and query local SQLite files.', author: 'community' },
  { category: 'Data', name: 'bigquery', description: 'Run scoped queries against BigQuery datasets.', author: 'community' },
  { category: 'Workspace', name: 'linear', description: 'Read and update issues, cycles, and project status.', author: 'linear' },
  { category: 'Workspace', name: 'slack', description: 'Search channels and post messages as a bot user.', author: 'community' },
  { category: 'Workspace', name: 'notion', description: 'Read pages and databases from a Notion workspace.', author: 'community' },
]

const CATEGORIES = ['Code & repos', 'Data', 'Workspace']

export function McpServers() {
  const tab = useRoster((s) => s.mcpTab)
  const setTab = useRoster((s) => s.setMcpTab)

  return (
    <div className="flex h-screen flex-col">
      <ScreenHeader title="MCP servers">
        <Segmented
          ariaLabel="MCP view"
          options={TABS}
          value={tab}
          onChange={(value: McpTab) => setTab(value)}
        />
      </ScreenHeader>

      {tab === 'installed' ? <Installed /> : <Registry />}
    </div>
  )
}

function Installed() {
  const servers = useRoster((s) => s.mcpServers)
  const agents = useRoster((s) => s.agents)
  const setMcpServers = useRoster((s) => s.setMcpServers)

  async function toggle(server: string, agentId: string, enabled: boolean): Promise<void> {
    await window.roster.mcp.setEnabled(server, agentId, enabled)
    setMcpServers(await window.roster.mcp.list())
  }

  if (servers.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-md text-dim">
        No MCP servers configured yet.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 max-w-[940px] flex-1 flex-col gap-[10px] overflow-y-auto px-[22px] py-[18px]">
      {servers.map((server) => (
        <article
          key={server.name}
          className="flex flex-col gap-[11px] rounded-[9px] border border-line bg-card px-[15px] py-[13px]"
        >
          <div className="flex items-center gap-[10px]">
            <span aria-hidden className="h-[22px] w-[22px] flex-none rounded-chip bg-[#20222b]" />
            <h2 className="m-0 text-xl font-semibold">{server.name}</h2>
            <span className="truncate font-mono text-sm text-dim-2">{server.command}</span>
            <span className="ml-auto flex-none text-base text-dim">
              {server.enabledFor.length === 1 ? '1 agent' : `${server.enabledFor.length} agents`}
            </span>
          </div>

          <div className="flex flex-wrap gap-[7px]">
            {agents.map((agent) => {
              const on = server.enabledFor.includes(agent.id)
              return (
                <button
                  key={agent.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => void toggle(server.name, agent.id, !on)}
                  className={`flex cursor-pointer items-center gap-[7px] rounded-[20px] border px-[9px] py-[4px] font-ui text-base ${
                    on
                      ? 'border-accent-line bg-accent-surface text-accent-text'
                      : 'border-line-input bg-transparent text-dim'
                  }`}
                  data-hoverable
                >
                  <span
                    aria-hidden
                    className="h-[5px] w-[5px] rounded-full"
                    style={{ background: on ? 'var(--color-accent)' : 'var(--color-off)' }}
                  />
                  {agent.name.replace(' Agent', '')}
                </button>
              )
            })}
          </div>
        </article>
      ))}
    </div>
  )
}

/** The launch command Roster writes when installing from the registry. */
function launchCommandFor(name: string): string {
  return `npx @modelcontextprotocol/server-${name}`
}

function Registry() {
  const servers = useRoster((s) => s.mcpServers)
  const setMcpServers = useRoster((s) => s.setMcpServers)
  const installed = new Set(servers.map((s) => s.name))

  async function install(name: string): Promise<void> {
    setMcpServers(await window.roster.mcp.install(name, launchCommandFor(name)))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-[22px] py-[18px]">
      {CATEGORIES.map((category) => (
        <section key={category} className="flex flex-col gap-[11px]">
          <SectionLabel>{category}</SectionLabel>
          <div className="grid gap-[11px] [grid-template-columns:repeat(auto-fill,minmax(232px,1fr))]">
            {REGISTRY.filter((entry) => entry.category === category).map((entry) => (
              <article
                key={entry.name}
                className="flex flex-col gap-[9px] rounded-[9px] border border-line bg-card p-[13px] hover:border-line-hover"
                data-hoverable
              >
                <div className="flex items-center gap-[9px]">
                  <span aria-hidden className="h-[20px] w-[20px] rounded-chip bg-[#20222b]" />
                  <h3 className="m-0 text-lg font-semibold">{entry.name}</h3>
                </div>
                <p className="m-0 min-h-[36px] text-md leading-[1.5] text-muted-2">
                  {entry.description}
                </p>
                <div className="flex items-center gap-[8px]">
                  <span className="font-mono text-xs text-faint-2">{entry.author}</span>
                  <button
                    type="button"
                    disabled={installed.has(entry.name)}
                    onClick={() => void install(entry.name)}
                    className="ml-auto cursor-pointer rounded-chip border border-line-active bg-transparent px-[10px] py-[3px] font-ui text-base font-medium text-accent-text hover:border-accent disabled:cursor-default disabled:opacity-40"
                    data-hoverable
                  >
                    {installed.has(entry.name) ? 'Installed' : 'Install'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
