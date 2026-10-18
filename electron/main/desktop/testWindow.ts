import { BrowserWindow } from 'electron'
import type { DesktopTestWindow } from './prototype'

/** No preload or Node access. The helper must supply the text through native key events. */
export class LocalDesktopTestWindow implements DesktopTestWindow {
  private window: BrowserWindow | null = null

  async open(nonce: string): Promise<void> {
    const title = `Roster Desktop Test ${nonce}`
    const window = new BrowserWindow({
      width: 720, height: 320, title, show: false, resizable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    })
    this.window = window
    const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title></head>
      <body style="font:18px system-ui;padding:28px;background:#15171d;color:#fff">
      <h2>Roster local control test</h2><p>Leave this window focused. The native helper will type a test phrase.</p>
      <input id="proof" aria-label="Test phrase" style="box-sizing:border-box;width:100%;font:16px monospace;padding:12px" autocomplete="off">
      <p>No files are created or edited. Close this window to stop the test.</p></body></html>`
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    window.show()
    window.focus()
    await window.webContents.executeJavaScript('document.getElementById("proof").focus()')
    // Let the native focus change settle before the helper independently checks it.
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  focused(): boolean { return this.window !== null && !this.window.isDestroyed() && this.window.isFocused() }

  async read(): Promise<string> {
    const window = this.window
    if (!window || window.isDestroyed()) throw new Error('The desktop test window was closed.')
    // Keyboard events are delivered asynchronously. Wait for the renderer to consume them.
    await new Promise(resolve => setTimeout(resolve, 300))
    return window.webContents.executeJavaScript('document.getElementById("proof").value') as Promise<string>
  }

  async capture(): Promise<string> {
    const window = this.window
    if (!window || window.isDestroyed()) throw new Error('The desktop test window was closed.')
    return (await window.webContents.capturePage()).toDataURL()
  }

  close(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }
}
