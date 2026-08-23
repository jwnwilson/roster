import { spawn, type IPty } from 'node-pty'

export interface PtySize {
  cols: number
  rows: number
}

interface PtyHandle {
  pty: IPty
  cwd: string
  shell: string
  /**
   * Everything the shell has written, so a pane that was navigated away from
   * comes back with its history rather than an empty screen. The pty itself
   * keeps no scrollback and xterm's buffer dies with the component.
   */
  scrollback: string
}

/**
 * How much output to keep per session. Enough for a long build's tail without
 * letting a chatty process grow unbounded in memory.
 */
const MAX_SCROLLBACK = 256 * 1024

/** Keeps the tail, which is the part worth reading. */
function trimScrollback(text: string): string {
  return text.length <= MAX_SCROLLBACK ? text : text.slice(text.length - MAX_SCROLLBACK)
}

/** Falls back sensibly when SHELL is unset, as it is under a launched .app. */
function defaultShell(): string {
  if (process.platform === 'win32') return process.env['COMSPEC'] ?? 'powershell.exe'
  return process.env['SHELL'] ?? '/bin/zsh'
}

/**
 * One pty per session, spawned in the agent's working directory.
 *
 * Sessions outlive the pane being visible, so a pty is kept alive when the
 * user switches away and only disposed when its session is closed.
 */
export class PtyManager {
  private ptys = new Map<string, PtyHandle>()
  private listeners = new Set<(sessionId: string, data: string) => void>()
  private exitListeners = new Set<(sessionId: string, code: number) => void>()

  onData(listener: (sessionId: string, data: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onExit(listener: (sessionId: string, code: number) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  /**
   * Idempotent: opening an already-open session returns the existing pty and
   * whatever it has printed so far, so reopening a pane restores its history.
   */
  open(
    sessionId: string,
    cwd: string,
    size: PtySize,
  ): { shell: string; cwd: string; history: string } {
    const existing = this.ptys.get(sessionId)
    if (existing) {
      return { shell: existing.shell, cwd: existing.cwd, history: existing.scrollback }
    }

    const shell = defaultShell()
    const pty = spawn(shell, [], {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
    })

    pty.onData((data) => {
      const handle = this.ptys.get(sessionId)
      if (handle) handle.scrollback = trimScrollback(handle.scrollback + data)
      for (const listener of this.listeners) listener(sessionId, data)
    })

    pty.onExit(({ exitCode }) => {
      this.ptys.delete(sessionId)
      for (const listener of this.exitListeners) listener(sessionId, exitCode)
    })

    this.ptys.set(sessionId, { pty, cwd, shell, scrollback: '' })
    return { shell, cwd, history: '' }
  }

  /** What this session has printed so far, for a pane being reopened. */
  history(sessionId: string): string {
    return this.ptys.get(sessionId)?.scrollback ?? ''
  }

  write(sessionId: string, data: string): void {
    this.ptys.get(sessionId)?.pty.write(data)
  }

  resize(sessionId: string, size: PtySize): void {
    const handle = this.ptys.get(sessionId)
    if (!handle) return

    // A zero dimension happens while the pane is hidden and would kill the pty.
    if (size.cols < 1 || size.rows < 1) return
    handle.pty.resize(size.cols, size.rows)
  }

  close(sessionId: string): void {
    const handle = this.ptys.get(sessionId)
    if (!handle) return

    this.ptys.delete(sessionId)
    handle.pty.kill()
  }

  isOpen(sessionId: string): boolean {
    return this.ptys.has(sessionId)
  }

  disposeAll(): void {
    for (const [id] of this.ptys) this.close(id)
    this.listeners.clear()
    this.exitListeners.clear()
  }
}
