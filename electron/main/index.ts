import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { disposeStores, initStores, registerIpc } from './ipc'

const isDev = !app.isPackaged

/** The generated app icon; see scripts/make-icon.py. */
const ICON_PATH = join(import.meta.dirname, '../../build/icon.png')

/**
 * A packaged app takes its icon from the bundle, but a dev run shows
 * Electron's own until it is set explicitly — so the icon is only verifiable
 * while developing if we do this.
 */
function applyDevIcon(): void {
  if (!isDev) return

  const icon = nativeImage.createFromPath(ICON_PATH)
  if (icon.isEmpty()) {
    process.stdout.write(`[icon] not found at ${ICON_PATH}; run scripts/make-icon.py\n`)
    return
  }
  app.dock?.setIcon(icon)
}

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
    icon: ICON_PATH,
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
 * Dev-only harness for driving the app without a human.
 *
 * ROSTER_SCRIPT=<file>     runs that JS in the renderer and awaits its result
 * ROSTER_SCREENSHOT=<path> writes the window to a PNG
 *
 * Together these give end-to-end checks of real flows — navigate, send a
 * message, wait for the reply — against the built app.
 */
async function captureIfRequested(win: BrowserWindow): Promise<void> {
  const script = process.env['ROSTER_SCRIPT']
  const target = process.env['ROSTER_SCREENSHOT']
  if (!isDev || (!target && !script)) return

  // Give webfonts and the initial hydrate a beat to land.
  await new Promise((resolve) => setTimeout(resolve, 1_500))

  if (script) {
    try {
      const source = await readFile(script, 'utf8')
      const result: unknown = await win.webContents.executeJavaScript(source, true)
      process.stdout.write(`[script] ${JSON.stringify(result)}\n`)
    } catch (cause) {
      process.stdout.write(`[script-error] ${cause instanceof Error ? cause.message : String(cause)}\n`)
    }
  }

  if (target) {
    const image = await win.webContents.capturePage()
    await writeFile(target, image.toPNG())
  }

  app.quit()
}

void app.whenReady().then(async () => {
  applyDevIcon()
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
