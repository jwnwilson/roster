import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { AgentDetail } from './screens/AgentDetail'
import { AgentsGrid } from './screens/AgentsGrid'
import { McpServers } from './screens/McpServers'
import { NewAgent } from './screens/NewAgent'
import { Skills } from './screens/Skills'
import { Spend } from './screens/Spend'
import { Tasks } from './screens/Tasks'
import { useRoster } from './state/store'

export function App() {
  const hydrate = useRoster((s) => s.hydrate)
  const setAgents = useRoster((s) => s.setAgents)
  const applySessionEvent = useRoster((s) => s.applySessionEvent)
  const setTranscripts = useRoster((s) => s.setTranscripts)
  const setAllSessions = useRoster((s) => s.setAllSessions)
  const setSpend = useRoster((s) => s.setSpend)
  const setUpdate = useRoster((s) => s.setUpdate)
  const setAppVersion = useRoster((s) => s.setAppVersion)
  const setProjects = useRoster((s) => s.setProjects)
  const setTasks = useRoster((s) => s.setTasks)
  const applyTaskEvent = useRoster((s) => s.applyTaskEvent)
  const loaded = useRoster((s) => s.loaded)
  const screen = useRoster((s) => s.screen)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      const [
        agents,
        runners,
        skills,
        mcpServers,
        transcripts,
        sessions,
        spend,
        projects,
        tasks,
        appVersion,
      ] = await Promise.all([
        window.roster.agents.list(),
        window.roster.runners.list(),
        window.roster.skills.list(),
        window.roster.mcp.list(),
        window.roster.sessions.recentByAgent(),
        window.roster.sessions.listAll(),
        window.roster.sessions.spendSummary(),
        window.roster.projects.list(),
        window.roster.tasks.list(),
        window.roster.update.version(),
      ])
      if (cancelled) return
      hydrate({ agents, runners, skills, mcpServers })
      setTranscripts(transcripts)
      setAllSessions(sessions)
      setSpend(spend)
      setProjects(projects)
      setTasks(tasks)
      setAppVersion(appVersion)
    }

    void load()
    // agent.toml can change outside Roster; reflect it without a restart.
    const stopAgents = window.roster.agents.onChanged(setAgents)
    // Live turn events: streamed text, tool calls, approvals, usage.
    const stopSessions = window.roster.sessions.onEvent((event) => {
      applySessionEvent(event)
      // Totals are summed in SQL across every session, which the renderer
      // cannot do from one session's event.
      if (event.type === 'usage') {
        void window.roster.sessions.spendSummary().then(setSpend)
      }
      // A finished turn changes what the grid cards should show.
      if (event.type === 'streaming' && !event.active) {
        void window.roster.sessions.recentByAgent().then(setTranscripts)
        void window.roster.sessions.listAll().then(setAllSessions)
      }
    })

    // Board changes, including ones an agent made partway through a turn.
    const stopTasks = window.roster.tasks.onEvent(applyTaskEvent)
    // The launch check runs in main; its result arrives here.
    const stopUpdates = window.roster.update.onStatus(setUpdate)

    return () => {
      cancelled = true
      stopAgents()
      stopSessions()
      stopTasks()
      stopUpdates()
    }
  }, [
    hydrate,
    setAgents,
    applySessionEvent,
    setTranscripts,
    setAllSessions,
    setSpend,
    setProjects,
    setTasks,
    applyTaskEvent,
    setUpdate,
    setAppVersion,
  ])

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
    case 'tasks':
      return <Tasks />
    case 'spend':
      return <Spend />
  }
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center text-md text-dim">
      Loading roster…
    </div>
  )
}
