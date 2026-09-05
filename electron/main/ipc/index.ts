import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  CHANNELS,
  type AgentPatch,
  type NewAgentInput,
  type NewProjectInput,
  type NewTaskInput,
  type ProjectPatch,
  type PtySize,
  type SendOptions,
  type NewConnectionInput,
  type TaskChange,
} from '../../../shared/ipc'
import type { PlanDocument, RunnerStatus, SpendSummary } from '../../../shared/types'
import { detectAllRunners } from '../auth/probes'
import { openDatabase, type Db } from '../db'
import { PtyManager } from '../pty/manager'
import { getRunner, registerCustomRunners, warmUpRunners } from '../runners/registry'
import { SessionManager } from '../sessions/manager'
import { TaskMentions } from '../sessions/mentions'
import { AgentStore } from '../store/agents'
import { McpStore, withServer } from '../store/mcp'
import { ProjectStore } from '../store/projects'
import { SessionStore } from '../store/sessions'
import { TaskStore } from '../store/tasks'
import { PlanStore } from '../store/plans'
import { NotionStore } from '../store/notion'
import { PlanFlow } from '../sessions/planFlow'
import { NotionClient, databaseIdFrom } from '../notion/client'
import { detectMapping, unmappedStatuses } from '../notion/mapping'
import { NotionPush, importConnection } from '../notion/sync'
import { NOTION_SERVER, NOTION_TOKEN_ENV } from '../../../shared/mcp'
import { SkillStore } from '../store/skills'
import { UsageStore } from '../store/usage'
import { Updater } from '../update/updater'
import { databasePath, mcpConfigPath, rosterHome } from '../store/paths'
import { join } from 'node:path'
import { seedIfEmpty } from '../store/seed'
import { seedBoardIfEmpty } from '../store/seedBoard'

let runners = new Map<string, RunnerStatus>()
let db: Db | null = null
let sessionStore: SessionStore | null = null
let usageStore: UsageStore | null = null
let projectStore: ProjectStore | null = null
let taskStore: TaskStore | null = null
let manager: SessionManager | null = null
let planStore: PlanStore | null = null
let planFlow: PlanFlow | null = null
let mentions: TaskMentions | null = null
let notionStore: NotionStore | null = null
let notionPush: NotionPush | null = null

/**
 * Built lazily, because app.getVersion() and the downloads path are only
 * meaningful once Electron is ready.
 */
let updater: Updater | null = null

function requireUpdater(): Updater {
  if (!updater) throw new Error('updater is not initialised')
  return updater
}

/** Everything the renderer asks for is done by the person at the keyboard. */
const YOU = { name: 'You', tone: 'you' } as const

/** What Spend reads before the database is open. */
const EMPTY_SPEND: SpendSummary = { byAgent: {}, byProject: {} }

const agentStore = new AgentStore(() => runners)
const skillStore = new SkillStore()
const mcpStore = new McpStore()
const ptyManager = new PtyManager()

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

function requirePlans(): PlanStore {
  if (!planStore) throw new Error('plan store is not initialised')
  return planStore
}

function requirePlanFlow(): PlanFlow {
  if (!planFlow) throw new Error('plan flow is not initialised')
  return planFlow
}

function requireSessions(): SessionStore {
  if (!sessionStore) throw new Error('session store is not initialised')
  return sessionStore
}

function requireMentions(): TaskMentions {
  if (!mentions) throw new Error('task mentions are not initialised')
  return mentions
}

function requireProjects(): ProjectStore {
  if (!projectStore) throw new Error('project store is not initialised')
  return projectStore
}

function requireNotion(): NotionStore {
  if (!notionStore) throw new Error('notion store is not initialised')
  return notionStore
}

/**
 * The Notion client, built from the token the `notion` MCP server already
 * holds.
 *
 * One token, in one place: mcp.json is where every other credential lives and
 * where the MCP screen's environment editor writes. Roster reads it rather
 * than keeping a second copy.
 */
function notionClient(): NotionClient | null {
  const token = mcpStore.findAll().find((s) => s.name === NOTION_SERVER)?.env[NOTION_TOKEN_ENV]
  return token === undefined || token.trim() === '' ? null : new NotionClient(token.trim())
}

function requireNotionClient(): NotionClient {
  const client = notionClient()
  if (!client)
    throw new Error(
      'No Notion token. Install the "notion" MCP server and set NOTION_TOKEN on it, ' +
        'from the MCP servers screen.',
    )
  return client
}

function requireTasks(): TaskStore {
  if (!taskStore) throw new Error('task store is not initialised')
  return taskStore
}

export async function initStores(): Promise<void> {
  await seedIfEmpty(mcpConfigPath())

  // Detect first: an agent's status depends on whether its runner is usable.
  runners = await detectAllRunners()
  await agentStore.load()
  await skillStore.load()
  await mcpStore.load()

  // Bring your own CLI: agents naming a custom command get a runner.
  registerCustomRunners(agentStore.findAll())
  await warmUpRunners()

  // Re-detect against any custom runners the loaded agents actually name.
  // Probed by their [custom] command, not the name the user gave the runner.
  const custom = agentStore
    .findAll()
    .filter((a) => !runners.has(a.runner) && a.custom)
    .map((a) => ({ id: a.runner, command: a.custom?.command ?? a.runner }))
  if (custom.length > 0) {
    runners = await detectAllRunners(custom)
    await agentStore.load()
  }

  db = openDatabase(databasePath())
  sessionStore = new SessionStore(db)
  usageStore = new UsageStore(db)
  projectStore = new ProjectStore(db)
  // Agent ids resolve to display names through the agent store, since agents
  // live in agent.toml rather than in this database.
  taskStore = new TaskStore(db, (id) => agentStore.findById(id)?.name ?? null)
  notionStore = new NotionStore(db)
  seedBoardIfEmpty(projectStore, taskStore, agentStore.findAll())

  planStore = new PlanStore(db)

  manager = new SessionManager(
    agentStore,
    sessionStore,
    skillStore,
    mcpStore,
    usageStore,
    { tasks: taskStore, projects: projectStore },
    planStore,
  )
  planFlow = new PlanFlow(planStore, manager, (id) => agentStore.findById(id)?.cwd ?? null)

  manager.subscribe((event) => broadcast(CHANNELS.sessionsEvent, event))
  // One bridge, so a task an agent changes mid-turn reaches the board the
  // same way one the user dragged does.
  taskStore.subscribe((event) => broadcast(CHANNELS.tasksEvent, event))
  // The same bridge for plans: an agent revising one mid-turn has to reach an
  // open modal, and a second window has to see it too.
  planStore.subscribe((event) => broadcast(CHANNELS.plansEvent, event))
  // Mentioning an agent in a task's thread opens a session for it. The
  // attachment is broadcast on the board's own channel, since the task
  // detail panel is what shows it.
  mentions = new TaskMentions(
    () => agentStore.findAll(),
    sessionStore,
    taskStore,
    manager,
    (link) => broadcast(CHANNELS.tasksEvent, { type: 'task-session', taskId: link.taskId, link }),
  )
  // A second subscriber: what changes here is written back to the Notion page
  // it came from. Silent for tasks that did not come from Notion.
  notionPush = new NotionPush(
    taskStore,
    notionStore,
    () => agentStore.findAll(),
    () => notionClient(),
  )
  taskStore.subscribe((event) => {
    if (event.type === 'task-updated') notionPush?.taskChanged(event.task.id)
  })
  ptyManager.onData((sessionId, data) => broadcast(CHANNELS.ptyData, { sessionId, data }))
  ptyManager.onExit((sessionId, code) => broadcast(CHANNELS.ptyExit, { sessionId, code }))
  agentStore.watch((agents) => {
    registerCustomRunners(agents)
    broadcast(CHANNELS.agentsChanged, agents)
  })

  // ROSTER_RELEASE_URL points the check at a stand-in release, which is the
  // only way to exercise the offer/download path before one is published.
  const releaseUrl = process.env['ROSTER_RELEASE_URL']

  updater = new Updater({
    currentVersion: app.getVersion(),
    arch: process.arch,
    downloadDir: app.getPath('downloads'),
    fetch: globalThis.fetch,
    ...(releaseUrl ? { releaseUrl } : {}),
  })
  updater.subscribe((state) => broadcast(CHANNELS.updateStatus, state))
}

/**
 * The check that runs on launch.
 *
 * Silent, so a laptop that happens to be offline says nothing rather than
 * opening with an error. Skipped in development, where the running version
 * comes from package.json and there is no installed bundle to replace —
 * ROSTER_UPDATE_CHECK=1 forces it for testing the flow.
 */
export function checkForUpdatesOnLaunch(): void {
  if (!app.isPackaged && process.env['ROSTER_UPDATE_CHECK'] !== '1') return
  void updater?.check({ silent: true })
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
  ipcMain.handle(CHANNELS.agentsCreate, (_e, input: NewAgentInput) =>
    agentStore.create({
      ...input,
      cwd: input.cwd ?? join(rosterHome(), 'workspace'),
      mcpServers: input.mcpServers ?? [],
    }),
  )
  ipcMain.handle(CHANNELS.agentsUpdate, (_e, id: string, patch: AgentPatch) =>
    agentStore.update(id, patch),
  )

  ipcMain.handle(CHANNELS.sessionsListByAgent, (_e, agentId: string) =>
    requireSessions().listByAgent(agentId),
  )
  ipcMain.handle(CHANNELS.sessionsRecentByAgent, () => requireSessions().recentByAgent())
  ipcMain.handle(CHANNELS.sessionsListAll, () => requireSessions().listAll())
  ipcMain.handle(
    CHANNELS.sessionsCreate,
    (_e, agentId: string, title?: string, projectId?: string | null) =>
      requireManager().create(agentId, title, projectId),
  )
  ipcMain.handle(CHANNELS.sessionsMessages, (_e, sessionId: string) =>
    requireSessions().messages(sessionId),
  )
  ipcMain.handle(CHANNELS.sessionsUsage, (_e, sessionId: string) =>
    usageStore?.forSession(sessionId) ?? null,
  )
  ipcMain.handle(CHANNELS.sessionsSpendSummary, () => usageStore?.summary() ?? EMPTY_SPEND)
  ipcMain.handle(
    CHANNELS.sessionsSend,
    (_e, sessionId: string, prompt: string, options?: SendOptions) =>
      requireManager().send(sessionId, prompt, options ?? {}),
  )
  ipcMain.handle(CHANNELS.sessionsCancel, (_e, sessionId: string) =>
    requireManager().cancel(sessionId),
  )
  ipcMain.handle(
    CHANNELS.sessionsRespondToApproval,
    (
      _e,
      sessionId: string,
      approvalId: string,
      approved: boolean,
      answers?: Record<string, string>,
    ) =>
      requireManager().respondToApproval(sessionId, approvalId, {
        approved,
        ...(answers !== undefined ? { answers } : {}),
      }),
  )
  ipcMain.handle(CHANNELS.sessionsPendingApprovals, (_e, sessionId: string) =>
    requireManager().pendingApprovals(sessionId),
  )

  ipcMain.handle(CHANNELS.ptyOpen, (_e, sessionId: string, cwd: string, size: PtySize) =>
    ptyManager.open(sessionId, cwd, size),
  )
  ipcMain.on(CHANNELS.ptyWrite, (_e, sessionId: string, data: string) =>
    ptyManager.write(sessionId, data),
  )
  ipcMain.on(CHANNELS.ptyResize, (_e, sessionId: string, size: PtySize) =>
    ptyManager.resize(sessionId, size),
  )
  ipcMain.on(CHANNELS.ptyClose, (_e, sessionId: string) => ptyManager.close(sessionId))

  ipcMain.handle(CHANNELS.skillsList, () => skillStore.findAll())
  ipcMain.handle(CHANNELS.skillsRead, (_e, path: string) => skillStore.read(path))
  ipcMain.handle(CHANNELS.skillsWrite, (_e, path: string, contents: string) =>
    skillStore.write(path, contents),
  )

  ipcMain.handle(CHANNELS.skillsCreate, (_e, name: string) => skillStore.create(name))
  ipcMain.handle(CHANNELS.skillsLink, (_e, directory: string) => skillStore.link(directory))
  ipcMain.handle(CHANNELS.skillsCreateFile, (_e, skill: string, path: string) =>
    skillStore.createFile(skill, path),
  )
  ipcMain.handle(CHANNELS.skillsCreateFolder, (_e, skill: string, path: string) =>
    skillStore.createFolder(skill, path),
  )
  ipcMain.handle(CHANNELS.skillsReveal, (_e, name: string) => {
    const path = skillStore.pathOf(name)
    // Nothing to reveal is not an error; the folder may have just been deleted.
    if (path !== null) shell.showItemInFolder(path)
  })

  ipcMain.handle(
    CHANNELS.skillsRemove,
    async (e, skill: string, path: string) => {
      const confirmed = await confirmDelete(e, path, 'This moves it to the Trash.')
      if (!confirmed) return false
      await skillStore.remove(skill, path)
      return true
    },
  )

  ipcMain.handle(CHANNELS.skillsRemoveSkill, async (e, skill: string) => {
    // A linked skill lives in a folder of the user's own; removing it removes
    // only the link, so the dialog must not threaten their files.
    const linked = skillStore.findAll().find((s) => s.name === skill)?.linkedFrom

    const confirmed = await confirmDelete(
      e,
      skill,
      linked === undefined
        ? 'The whole skill and everything in it moves to the Trash. Agents using it will lose it.'
        : `Only the link is removed — ${linked} stays where it is. Agents using it will lose it.`,
      linked === undefined ? 'Delete' : 'Remove',
    )
    if (!confirmed) return false
    await skillStore.removeSkill(skill)
    return true
  })

  ipcMain.handle(CHANNELS.mcpList, () => mcpStore.findAll())
  ipcMain.handle(
    CHANNELS.mcpSetEnabled,
    async (_e, server: string, agentId: string, enabled: boolean) => {
      // Enablement is a property of the agent, so this is an agent.toml edit.
      const agent = agentStore.findById(agentId)
      if (!agent) throw new Error(`unknown agent "${agentId}"`)

      return agentStore.update(agentId, {
        mcpServers: withServer(agent.mcpServers, server, enabled),
      })
    },
  )
  ipcMain.handle(CHANNELS.mcpInstall, (_e, name: string, command: string) =>
    mcpStore.install(name, command),
  )
  ipcMain.handle(
    CHANNELS.mcpSave,
    (_e, name: string, command: string, env: Record<string, string>) =>
      mcpStore.save(name, command, env),
  )

  ipcMain.handle(CHANNELS.sessionsSetProject, (_e, sessionId: string, projectId: string | null) =>
    requireSessions().setProject(sessionId, projectId),
  )

  ipcMain.handle(CHANNELS.notionInspect, async (_e, databaseInput: string) => {
    const databaseId = databaseIdFrom(databaseInput)
    if (databaseId === null) {
      throw new Error('That is not a Notion database link or id.')
    }

    const client = requireNotionClient()
    const sources = await client.dataSources(databaseId)
    const source = sources[0]
    if (!source) {
      throw new Error('That database has no data sources Roster can read.')
    }

    const schema = await client.schema(source.id)
    const mapping = detectMapping(schema.properties)

    return {
      databaseId,
      dataSourceId: source.id,
      name: schema.title === '' ? source.name : schema.title,
      properties: schema.properties,
      mapping,
      unmapped: unmappedStatuses(mapping),
    }
  })

  ipcMain.handle(CHANNELS.notionConnect, (_e, input: NewConnectionInput) =>
    requireNotion().create(input),
  )
  ipcMain.handle(CHANNELS.notionConnections, () => requireNotion().findAll())
  ipcMain.handle(CHANNELS.notionDisconnect, (_e, id: string) => requireNotion().delete(id))

  ipcMain.handle(CHANNELS.notionImport, async (_e, connectionId: string) => {
    const connection = requireNotion().findById(connectionId)
    if (!connection) throw new Error(`unknown Notion connection "${connectionId}"`)

    const client = requireNotionClient()
    const tasks = requireTasks()

    // Suppressed for the duration, or every row pulled in would immediately
    // push straight back out again.
    const run = () => importConnection(client, connection, tasks, () => agentStore.findAll())
    return notionPush ? notionPush.duringImport(run) : run()
  })

  ipcMain.handle(CHANNELS.projectsList, () => requireProjects().findAll())
  ipcMain.handle(CHANNELS.projectsCreate, (_e, input: NewProjectInput) =>
    requireProjects().create(input),
  )
  ipcMain.handle(CHANNELS.projectsUpdate, (_e, id: string, patch: ProjectPatch) =>
    requireProjects().update(id, patch),
  )
  ipcMain.handle(CHANNELS.projectsSetArchived, (_e, id: string, archived: boolean) => {
    const project = requireProjects().setArchived(id, archived)
    // Archiving takes a project's work off the board and out of every picker,
    // so every window needs the new list — not just the one that clicked.
    broadcast(CHANNELS.tasksEvent, { type: 'projects', projects: requireProjects().findAll() })
    return project
  })

  ipcMain.handle(CHANNELS.projectsDelete, async (e, id: string) => {
    const project = requireProjects().findById(id)
    if (!project) return false

    // Archiving is the reversible everyday verb; this is the one that cannot
    // be taken back, so it asks first — as removing a skill does.
    const confirmed = await confirmDelete(
      e,
      project.name,
      'Its tasks and sessions are kept — they only lose the grouping. This cannot be undone.',
    )
    if (!confirmed) return false

    requireProjects().delete(id)
    // Deleting a project changes every card that referenced it, so the board
    // needs the new list as well as the detached tasks.
    broadcast(CHANNELS.tasksEvent, { type: 'projects', projects: requireProjects().findAll() })
    return true
  })

  ipcMain.handle(CHANNELS.tasksList, () => requireTasks().findAll())
  ipcMain.handle(CHANNELS.tasksCreate, (_e, input: NewTaskInput) => requireTasks().create(input))
  ipcMain.handle(CHANNELS.tasksApply, (_e, taskId: string, change: TaskChange) => {
    // The actor is decided here, never sent from the renderer — otherwise a
    // change could be logged as though an agent had made it.
    return requireTasks().apply(taskId, change, YOU).task
  })
  ipcMain.handle(CHANNELS.tasksDelete, async (e, taskId: string) => {
    const task = requireTasks().findById(taskId)
    if (!task) return false

    // A task has no archive to fall back on the way a project does, and its
    // comments and history go with it through the foreign key — so this asks
    // first, as deleting a project or a skill does.
    const confirmed = await confirmDelete(
      e,
      task.title,
      'Its comments and history go with it. This cannot be undone.',
    )
    if (!confirmed) return false

    requireTasks().delete(taskId)
    return true
  })
  ipcMain.handle(CHANNELS.tasksComments, (_e, taskId: string) => requireTasks().comments(taskId))
  ipcMain.handle(CHANNELS.tasksComment, (_e, taskId: string, text: string) => {
    const comment = requireTasks().comment(taskId, {
      author: YOU.name,
      tone: YOU.tone,
      text,
    })

    // Deliberately not awaited: a turn runs for as long as the agent takes,
    // and posting a comment must not wait for it. A failure reaches the
    // thread as a comment rather than as a rejection here.
    void requireMentions().dispatch(taskId, text)

    return comment
  })

  ipcMain.handle(CHANNELS.tasksSessions, (_e, taskId: string) =>
    requireSessions().linksForTask(taskId),
  )

  ipcMain.handle(CHANNELS.plansListBySession, (_e, sessionId: string) =>
    requirePlans().listBySession(sessionId),
  )
  ipcMain.handle(CHANNELS.plansRead, (_e, planId: string): PlanDocument => {
    const plans = requirePlans()
    const plan = plans.findById(planId)
    if (!plan) throw new Error(`unknown plan "${planId}"`)
    return { plan, body: plans.body(planId) }
  })
  ipcMain.handle(CHANNELS.plansComments, (_e, planId: string) => requirePlans().comments(planId))
  // Both of these start a turn on the session that wrote the plan; the
  // sequencing around a still-blocked ExitPlanMode lives in PlanFlow.
  ipcMain.handle(CHANNELS.plansSubmit, (_e, planId: string, text: string, quote?: string) =>
    requirePlanFlow().submit(planId, text, quote),
  )
  ipcMain.handle(CHANNELS.plansApprove, (_e, planId: string) => requirePlanFlow().approve(planId))

  ipcMain.handle(CHANNELS.updateVersion, () => app.getVersion())
  ipcMain.handle(CHANNELS.updateCheck, () => requireUpdater().check())
  ipcMain.handle(CHANNELS.updateDownload, () => requireUpdater().download())

  ipcMain.handle(CHANNELS.updateInstall, async () => {
    const state = requireUpdater().current()
    if (state.status !== 'ready') return

    // Opening the DMG mounts it and brings up its window; the user drags
    // Roster across. An unsigned build cannot replace itself in place.
    const error = await shell.openPath(state.path)
    // openPath reports failure by returning a message rather than throwing,
    // so a silent no-op here would look like nothing happened.
    if (error) shell.showItemInFolder(state.path)
  })

  ipcMain.handle(CHANNELS.dialogChooseDirectory, async (e, current?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      ...(current !== undefined && current !== '' ? { defaultPath: current } : {}),
    }

    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}

/**
 * Asks before destroying something. Lives in the main process so a caller in
 * the renderer cannot skip it, and defaults to Cancel so that dismissing the
 * dialog never deletes anything.
 */
async function confirmDelete(
  event: Electron.IpcMainInvokeEvent,
  name: string,
  detail: string,
  verb = 'Delete',
): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: ['Cancel', verb],
    defaultId: 0,
    cancelId: 0,
    message: `${verb} "${name}"?`,
    detail,
  }

  const result = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)

  return result.response === 1
}

export function disposeStores(): void {
  ptyManager.disposeAll()
  agentStore.dispose()
  skillStore.dispose()
  mcpStore.dispose()
  notionPush?.dispose()
  db?.close()
}
