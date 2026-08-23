import { homedir } from 'node:os'
import { BrowserWindow, ipcMain } from 'electron'
import { CHANNELS, type AgentPatch } from '../../../shared/ipc'
import type { RunnerStatus } from '../../../shared/types'
import { detectAllRunners } from '../auth/probes'
import { AgentStore } from '../store/agents'
import { McpStore } from '../store/mcp'
import { SkillStore } from '../store/skills'
import { mcpConfigPath } from '../store/paths'
import { seedIfEmpty } from '../store/seed'

let runners = new Map<string, RunnerStatus>()

const agentStore = new AgentStore(() => runners)
const skillStore = new SkillStore()
const mcpStore = new McpStore()

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export async function initStores(): Promise<void> {
  await seedIfEmpty(homedir(), mcpConfigPath())

  // Detect first: agent status depends on whether its runner is usable.
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

  ipcMain.handle(CHANNELS.agentsList, () => agentStore.findAll())
  ipcMain.handle(CHANNELS.agentsGet, (_e, id: string) => agentStore.findById(id))
  ipcMain.handle(CHANNELS.agentsUpdate, (_e, id: string, patch: AgentPatch) =>
    agentStore.update(id, patch),
  )

  ipcMain.handle(CHANNELS.skillsList, () => skillStore.findAll())
  ipcMain.handle(CHANNELS.skillsRead, (_e, path: string) => skillStore.read(path))

  ipcMain.handle(CHANNELS.mcpList, () => mcpStore.findAll())
  ipcMain.handle(CHANNELS.mcpSetEnabled, (_e, server: string, agentId: string, enabled: boolean) =>
    mcpStore.setEnabled(server, agentId, enabled),
  )

  // Sessions land with the runner layer; the renderer treats empty as "no
  // sessions yet" rather than an error.
  ipcMain.handle(CHANNELS.sessionsListByAgent, () => [])
  ipcMain.handle(CHANNELS.sessionsMessages, () => [])
  ipcMain.handle(CHANNELS.sessionsUsage, () => null)
}

export function disposeStores(): void {
  agentStore.dispose()
  skillStore.dispose()
  mcpStore.dispose()
}
