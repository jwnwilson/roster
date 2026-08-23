import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type AgentPatch, type RosterApi } from '../../shared/ipc'
import type { Agent } from '../../shared/types'

const api: RosterApi = {
  window: {
    minimize: () => ipcRenderer.send(CHANNELS.windowMinimize),
    maximize: () => ipcRenderer.send(CHANNELS.windowMaximize),
    close: () => ipcRenderer.send(CHANNELS.windowClose),
  },
  runners: {
    list: () => ipcRenderer.invoke(CHANNELS.runnersList),
  },
  agents: {
    list: () => ipcRenderer.invoke(CHANNELS.agentsList),
    get: (id: string) => ipcRenderer.invoke(CHANNELS.agentsGet, id),
    update: (id: string, patch: AgentPatch) => ipcRenderer.invoke(CHANNELS.agentsUpdate, id, patch),
    onChanged: (listener: (agents: Agent[]) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, agents: Agent[]) => listener(agents)
      ipcRenderer.on(CHANNELS.agentsChanged, handler)
      return () => ipcRenderer.removeListener(CHANNELS.agentsChanged, handler)
    },
  },
  sessions: {
    listByAgent: (agentId: string) => ipcRenderer.invoke(CHANNELS.sessionsListByAgent, agentId),
    messages: (sessionId: string) => ipcRenderer.invoke(CHANNELS.sessionsMessages, sessionId),
    usage: (sessionId: string) => ipcRenderer.invoke(CHANNELS.sessionsUsage, sessionId),
  },
  skills: {
    list: () => ipcRenderer.invoke(CHANNELS.skillsList),
    read: (path: string) => ipcRenderer.invoke(CHANNELS.skillsRead, path),
  },
  mcp: {
    list: () => ipcRenderer.invoke(CHANNELS.mcpList),
    setEnabled: (server: string, agentId: string, enabled: boolean) =>
      ipcRenderer.invoke(CHANNELS.mcpSetEnabled, server, agentId, enabled),
  },
}

contextBridge.exposeInMainWorld('roster', api)
