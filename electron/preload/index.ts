import { contextBridge, ipcRenderer } from 'electron'
import {
  CHANNELS,
  type AgentPatch,
  type PtySize,
  type RosterApi,
  type SessionEventPayload,
} from '../../shared/ipc'
import type { Agent } from '../../shared/types'

/** Subscribes to a broadcast channel and returns its unsubscribe. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: RosterApi = {
  window: {
    minimize: () => ipcRenderer.send(CHANNELS.windowMinimize),
    maximize: () => ipcRenderer.send(CHANNELS.windowMaximize),
    close: () => ipcRenderer.send(CHANNELS.windowClose),
  },

  runners: {
    list: () => ipcRenderer.invoke(CHANNELS.runnersList),
    models: (runnerId) => ipcRenderer.invoke(CHANNELS.runnersModels, runnerId),
  },

  agents: {
    list: () => ipcRenderer.invoke(CHANNELS.agentsList),
    get: (id) => ipcRenderer.invoke(CHANNELS.agentsGet, id),
    create: (input) => ipcRenderer.invoke(CHANNELS.agentsCreate, input),
    update: (id, patch: AgentPatch) => ipcRenderer.invoke(CHANNELS.agentsUpdate, id, patch),
    onChanged: (listener: (agents: Agent[]) => void) =>
      subscribe(CHANNELS.agentsChanged, listener),
  },

  sessions: {
    listByAgent: (agentId) => ipcRenderer.invoke(CHANNELS.sessionsListByAgent, agentId),
    create: (agentId, title) => ipcRenderer.invoke(CHANNELS.sessionsCreate, agentId, title),
    messages: (sessionId) => ipcRenderer.invoke(CHANNELS.sessionsMessages, sessionId),
    usage: (sessionId) => ipcRenderer.invoke(CHANNELS.sessionsUsage, sessionId),
    send: (sessionId, prompt) => ipcRenderer.invoke(CHANNELS.sessionsSend, sessionId, prompt),
    cancel: (sessionId) => ipcRenderer.invoke(CHANNELS.sessionsCancel, sessionId),
    respondToApproval: (sessionId, approvalId, approved) =>
      ipcRenderer.invoke(CHANNELS.sessionsRespondToApproval, sessionId, approvalId, approved),
    pendingApprovals: (sessionId) =>
      ipcRenderer.invoke(CHANNELS.sessionsPendingApprovals, sessionId),
    onEvent: (listener: (event: SessionEventPayload) => void) =>
      subscribe(CHANNELS.sessionsEvent, listener),
  },

  pty: {
    open: (sessionId, cwd, size: PtySize) =>
      ipcRenderer.invoke(CHANNELS.ptyOpen, sessionId, cwd, size),
    write: (sessionId, data) => ipcRenderer.send(CHANNELS.ptyWrite, sessionId, data),
    resize: (sessionId, size: PtySize) => ipcRenderer.send(CHANNELS.ptyResize, sessionId, size),
    close: (sessionId) => ipcRenderer.send(CHANNELS.ptyClose, sessionId),
    onData: (listener) => subscribe(CHANNELS.ptyData, listener),
    onExit: (listener) => subscribe(CHANNELS.ptyExit, listener),
  },

  skills: {
    list: () => ipcRenderer.invoke(CHANNELS.skillsList),
    read: (path) => ipcRenderer.invoke(CHANNELS.skillsRead, path),
    write: (path, contents) => ipcRenderer.invoke(CHANNELS.skillsWrite, path, contents),
  },

  mcp: {
    list: () => ipcRenderer.invoke(CHANNELS.mcpList),
    setEnabled: (server, agentId, enabled) =>
      ipcRenderer.invoke(CHANNELS.mcpSetEnabled, server, agentId, enabled),
  },
}

contextBridge.exposeInMainWorld('roster', api)
