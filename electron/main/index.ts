import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { disposeStores, initStores, registerIpc } from './ipc'

const isDev = !app.isPackaged

/**
 * The design specifies its own window chrome — a 44px sidebar header carrying
 * the wordmark and three control dots — so the native frame is removed
 * entirely rather than hidden, which on macOS would leave the traffic lights
 * drawn over the logo.
 */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#111216',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    win.webContents.on('console-message', (event) => {
      process.stdout.write(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})\n`)
    })
    win.webContents.on('preload-error', (_e, path, error) => {
      process.stdout.write(`[preload-error] ${path}: ${error.message}\n`)
    })
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      process.stdout.write(`[did-fail-load] ${code} ${desc}\n`)
    })
  }

  win.once('ready-to-show', () => {
    win.show()
    void captureIfRequested(win)
  })

  // External links open in the user's browser, never in the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return win
}

/**
 * Dev-only: ROSTER_SCREENSHOT=<path> renders the window to a PNG and exits.
 * Used for visual checks against the design reference.
 */
async function captureIfRequested(win: BrowserWindow): Promise<void> {
  const target = process.env['ROSTER_SCREENSHOT']
  if (!isDev || !target) return

  // Give webfonts a beat to land before capturing.
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  const image = await win.webContents.capturePage()
  await writeFile(target, image.toPNG())
  app.quit()
}

void app.whenReady().then(async () => {
  registerIpc()
  await initStores()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', disposeStores)
