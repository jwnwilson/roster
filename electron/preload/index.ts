import { contextBridge, ipcRenderer } from 'electron'
import {
  CHANNELS,
  type AgentPatch,
  type PtySize,
  type RosterApi,
  type SessionEventPayload,
  type PlanEventPayload,
  type TaskEventPayload,
} from '../../shared/ipc'
import type { Agent, UpdateState } from '../../shared/types'

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
    recentByAgent: () => ipcRenderer.invoke(CHANNELS.sessionsRecentByAgent),
    listAll: () => ipcRenderer.invoke(CHANNELS.sessionsListAll),
    create: (agentId, title) => ipcRenderer.invoke(CHANNELS.sessionsCreate, agentId, title),
    messages: (sessionId) => ipcRenderer.invoke(CHANNELS.sessionsMessages, sessionId),
    usage: (sessionId) => ipcRenderer.invoke(CHANNELS.sessionsUsage, sessionId),
    spendSummary: () => ipcRenderer.invoke(CHANNELS.sessionsSpendSummary),
    send: (sessionId, prompt, options) =>
      ipcRenderer.invoke(CHANNELS.sessionsSend, sessionId, prompt, options),
    cancel: (sessionId) => ipcRenderer.invoke(CHANNELS.sessionsCancel, sessionId),
    setProject: (sessionId, projectId) =>
      ipcRenderer.invoke(CHANNELS.sessionsSetProject, sessionId, projectId),
    setName: (sessionId, name) => ipcRenderer.invoke(CHANNELS.sessionsSetName, sessionId, name),
    respondToApproval: (sessionId, approvalId, approved, answers) =>
      ipcRenderer.invoke(
        CHANNELS.sessionsRespondToApproval,
        sessionId,
        approvalId,
        approved,
        answers,
      ),
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
    create: (name) => ipcRenderer.invoke(CHANNELS.skillsCreate, name),
    link: (directory) => ipcRenderer.invoke(CHANNELS.skillsLink, directory),
    createFile: (skillName, relativePath) =>
      ipcRenderer.invoke(CHANNELS.skillsCreateFile, skillName, relativePath),
    createFolder: (skillName, relativePath) =>
      ipcRenderer.invoke(CHANNELS.skillsCreateFolder, skillName, relativePath),
    reveal: (name) => ipcRenderer.invoke(CHANNELS.skillsReveal, name),
    remove: (skillName, relativePath) =>
      ipcRenderer.invoke(CHANNELS.skillsRemove, skillName, relativePath),
    removeSkill: (skillName) => ipcRenderer.invoke(CHANNELS.skillsRemoveSkill, skillName),
  },

  mcp: {
    list: () => ipcRenderer.invoke(CHANNELS.mcpList),
    setEnabled: (server, agentId, enabled) =>
      ipcRenderer.invoke(CHANNELS.mcpSetEnabled, server, agentId, enabled),
    install: (name, command) => ipcRenderer.invoke(CHANNELS.mcpInstall, name, command),
    save: (name, command, env) => ipcRenderer.invoke(CHANNELS.mcpSave, name, command, env),
  },

  notion: {
    inspect: (databaseInput) => ipcRenderer.invoke(CHANNELS.notionInspect, databaseInput),
    connect: (input) => ipcRenderer.invoke(CHANNELS.notionConnect, input),
    connections: () => ipcRenderer.invoke(CHANNELS.notionConnections),
    importNow: (connectionId) => ipcRenderer.invoke(CHANNELS.notionImport, connectionId),
    disconnect: (id) => ipcRenderer.invoke(CHANNELS.notionDisconnect, id),
  },

  projects: {
    list: () => ipcRenderer.invoke(CHANNELS.projectsList),
    create: (input) => ipcRenderer.invoke(CHANNELS.projectsCreate, input),
    update: (id, patch) => ipcRenderer.invoke(CHANNELS.projectsUpdate, id, patch),
    setArchived: (id, archived) =>
      ipcRenderer.invoke(CHANNELS.projectsSetArchived, id, archived),
    remove: (id) => ipcRenderer.invoke(CHANNELS.projectsDelete, id),
  },

  tasks: {
    list: () => ipcRenderer.invoke(CHANNELS.tasksList),
    create: (input) => ipcRenderer.invoke(CHANNELS.tasksCreate, input),
    apply: (taskId, change) => ipcRenderer.invoke(CHANNELS.tasksApply, taskId, change),
    remove: (taskId) => ipcRenderer.invoke(CHANNELS.tasksDelete, taskId),
    comments: (taskId) => ipcRenderer.invoke(CHANNELS.tasksComments, taskId),
    comment: (taskId, text) => ipcRenderer.invoke(CHANNELS.tasksComment, taskId, text),
    sessions: (taskId) => ipcRenderer.invoke(CHANNELS.tasksSessions, taskId),
    onEvent: (listener) => subscribe<TaskEventPayload>(CHANNELS.tasksEvent, listener),
  },

  plans: {
    listBySession: (sessionId: string) => ipcRenderer.invoke(CHANNELS.plansListBySession, sessionId),
    read: (planId: string) => ipcRenderer.invoke(CHANNELS.plansRead, planId),
    comments: (planId: string) => ipcRenderer.invoke(CHANNELS.plansComments, planId),
    submit: (planId: string, text: string, quote?: string) =>
      ipcRenderer.invoke(CHANNELS.plansSubmit, planId, text, quote),
    approve: (planId: string) => ipcRenderer.invoke(CHANNELS.plansApprove, planId),
    onEvent: (listener) => subscribe<PlanEventPayload>(CHANNELS.plansEvent, listener),
  },

  update: {
    check: () => ipcRenderer.invoke(CHANNELS.updateCheck),
    download: () => ipcRenderer.invoke(CHANNELS.updateDownload),
    install: () => ipcRenderer.invoke(CHANNELS.updateInstall),
    version: () => ipcRenderer.invoke(CHANNELS.updateVersion),
    onStatus: (listener: (state: UpdateState) => void) =>
      subscribe(CHANNELS.updateStatus, listener),
  },

  dialog: {
    chooseDirectory: (current) => ipcRenderer.invoke(CHANNELS.dialogChooseDirectory, current),
  },
}

contextBridge.exposeInMainWorld('roster', api)
