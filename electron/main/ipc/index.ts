import { BrowserWindow, ipcMain } from 'electron'
import { CHANNELS, type AgentPatch } from '../../../shared/ipc'
import type { RunnerStatus } from '../../../shared/types'
import { detectAllRunners } from '../auth/probes'
import { openDatabase, type Db } from '../db'
import { getRunner } from '../runners/registry'
import { SessionManager } from '../sessions/manager'
import { AgentStore } from '../store/agents'
import { McpStore } from '../store/mcp'
import { SessionStore } from '../store/sessions'
import { SkillStore } from '../store/skills'
import { UsageStore } from '../store/usage'
import { databasePath, mcpConfigPath } from '../store/paths'
import { seedIfEmpty } from '../store/seed'

let runners = new Map<string, RunnerStatus>()
let db: Db | null = null
let sessionStore: SessionStore | null = null
let usageStore: UsageStore | null = null
let manager: SessionManager | null = null

const agentStore = new AgentStore(() => runners)
const skillStore = new SkillStore()
const mcpStore = new McpStore()

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

/** Throws rather than returning undefined, so a wiring mistake is loud. */
function requireManager(): SessionManager {
  if (!manager) throw new Error('session manager is not initialised')
  return manager
}

function requireSessions(): SessionStore {
  if (!sessionStore) throw new Error('session store is not initialised')
  return sessionStore
}

export async function initStores(): Promise<void> {
  await seedIfEmpty(mcpConfigPath())

  // Detect first: an agent's status depends on whether its runner is usable.
  runners = await detectAllRunners()
  await agentStore.load()
  await skillStore.load()
  await mcpStore.load()

  // Re-detect against any custom runners the loaded agents actually name.
  const customIds = agentStore
    .findAll()
    .map((a) => a.runner)
    .filter((id) => !runners.has(id))
  if (customIds.length > 0) {
    runners = await detectAllRunners(customIds)
    await agentStore.load()
  }

  db = openDatabase(databasePath())
  sessionStore = new SessionStore(db)
  usageStore = new UsageStore(db)
  manager = new SessionManager(agentStore, sessionStore, skillStore, mcpStore, usageStore)

  manager.subscribe((event) => broadcast(CHANNELS.sessionsEvent, event))
  agentStore.watch((agents) => broadcast(CHANNELS.agentsChanged, agents))
}

export function registerIpc(): void {
  ipcMain.on(CHANNELS.windowMinimize, (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on(CHANNELS.windowMaximize, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.on(CHANNELS.windowClose, (e) => BrowserWindow.fromWebContents(e.sender)?.close())

  ipcMain.handle(CHANNELS.runnersList, () => [...runners.values()])
  ipcMain.handle(CHANNELS.runnersModels, (_e, runnerId: string) =>
    getRunner(runnerId)?.models() ?? [],
  )

  ipcMain.handle(CHANNELS.agentsList, () => agentStore.findAll())
  ipcMain.handle(CHANNELS.agentsGet, (_e, id: string) => agentStore.findById(id))
  ipcMain.handle(CHANNELS.agentsUpdate, (_e, id: string, patch: AgentPatch) =>
    agentStore.update(id, patch),
  )

  ipcMain.handle(CHANNELS.sessionsListByAgent, (_e, agentId: string) =>
    requireSessions().listByAgent(agentId),
  )
  ipcMain.handle(CHANNELS.sessionsCreate, (_e, agentId: string, title?: string) =>
    requireManager().create(agentId, title),
  )
  ipcMain.handle(CHANNELS.sessionsMessages, (_e, sessionId: string) =>
    requireSessions().messages(sessionId),
  )
  ipcMain.handle(CHANNELS.sessionsUsage, (_e, sessionId: string) =>
    usageStore?.forSession(sessionId) ?? null,
  )
  ipcMain.handle(CHANNELS.sessionsSend, (_e, sessionId: string, prompt: string) =>
    requireManager().send(sessionId, prompt),
  )
  ipcMain.handle(CHANNELS.sessionsCancel, (_e, sessionId: string) =>
    requireManager().cancel(sessionId),
  )
  ipcMain.handle(
    CHANNELS.sessionsRespondToApproval,
    (_e, sessionId: string, approvalId: string, approved: boolean) =>
      requireManager().respondToApproval(sessionId, approvalId, { approved }),
  )
  ipcMain.handle(CHANNELS.sessionsPendingApprovals, (_e, sessionId: string) =>
    requireManager().pendingApprovals(sessionId),
  )

  ipcMain.handle(CHANNELS.skillsList, () => skillStore.findAll())
  ipcMain.handle(CHANNELS.skillsRead, (_e, path: string) => skillStore.read(path))
  ipcMain.handle(CHANNELS.skillsWrite, (_e, path: string, contents: string) =>
    skillStore.write(path, contents),
  )

  ipcMain.handle(CHANNELS.mcpList, () => mcpStore.findAll())
  ipcMain.handle(CHANNELS.mcpSetEnabled, (_e, server: string, agentId: string, enabled: boolean) =>
    mcpStore.setEnabled(server, agentId, enabled),
  )
}

export function disposeStores(): void {
  agentStore.dispose()
  skillStore.dispose()
  mcpStore.dispose()
  db?.close()
}
