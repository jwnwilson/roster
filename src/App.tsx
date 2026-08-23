import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { AgentDetail } from './screens/AgentDetail'
import { AgentsGrid } from './screens/AgentsGrid'
import { McpServers } from './screens/McpServers'
import { NewAgent } from './screens/NewAgent'
import { Skills } from './screens/Skills'
import { useRoster } from './state/store'

export function App() {
  const hydrate = useRoster((s) => s.hydrate)
  const setAgents = useRoster((s) => s.setAgents)
  const applySessionEvent = useRoster((s) => s.applySessionEvent)
  const loaded = useRoster((s) => s.loaded)
  const screen = useRoster((s) => s.screen)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      const [agents, runners, skills, mcpServers] = await Promise.all([
        window.roster.agents.list(),
        window.roster.runners.list(),
        window.roster.skills.list(),
        window.roster.mcp.list(),
      ])
      if (!cancelled) hydrate({ agents, runners, skills, mcpServers })
    }

    void load()
    // agent.toml can change outside Roster; reflect it without a restart.
    const stopAgents = window.roster.agents.onChanged(setAgents)
    // Live turn events: streamed text, tool calls, approvals, usage.
    const stopSessions = window.roster.sessions.onEvent(applySessionEvent)

    return () => {
      cancelled = true
      stopAgents()
      stopSessions()
    }
  }, [hydrate, setAgents, applySessionEvent])

  return (
    <div className="flex h-screen w-full overflow-hidden bg-app font-ui text-xl text-ink">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {!loaded ? <Loading /> : <Screen screen={screen} />}
      </main>
    </div>
  )
}

interface ScreenProps {
  screen: ReturnType<typeof useRoster.getState>['screen']
}

function Screen({ screen }: ScreenProps) {
  switch (screen) {
    case 'grid':
      return <AgentsGrid />
    case 'agent':
      return <AgentDetail />
    case 'skills':
      return <Skills />
    case 'mcp':
      return <McpServers />
    case 'new':
      return <NewAgent />
  }
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center text-md text-dim">
      Loading roster…
    </div>
  )
}
