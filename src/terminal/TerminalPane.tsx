import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

interface TerminalPaneProps {
  sessionId: string
  cwd: string
  cwdLabel: string
}

/** Terminal colours, matched to the design tokens rather than xterm defaults. */
const THEME = {
  background: '#0b0c0f',
  foreground: '#e6e6ea',
  cursor: '#7c5cff',
  cursorAccent: '#0b0c0f',
  selectionBackground: '#26283a',
  black: '#0b0c0f',
  red: '#c2553f',
  green: '#4fa86a',
  yellow: '#d9a04a',
  blue: '#7c5cff',
  magenta: '#a78bfa',
  cyan: '#8f93a3',
  white: '#c8cad4',
  brightBlack: '#5f6270',
  brightRed: '#c2553f',
  brightGreen: '#4fa86a',
  brightYellow: '#e8b262',
  brightBlue: '#8f74ff',
  brightMagenta: '#c4b5fd',
  brightCyan: '#b9bcc8',
  brightWhite: '#e6e6ea',
}

export function TerminalPane({ sessionId, cwd, cwdLabel }: TerminalPaneProps) {
  const host = useRef<HTMLDivElement>(null)
  const [shell, setShell] = useState('')
  const [size, setSize] = useState({ cols: 80, rows: 24 })

  useEffect(() => {
    const container = host.current
    if (!container) return

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 12,
      lineHeight: 1.35,
      theme: THEME,
      cursorBlink: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)

    let disposed = false

    // The pane can be laid out before it has a size; fit once it does.
    const applyFit = (): void => {
      if (disposed || container.clientWidth === 0 || container.clientHeight === 0) return
      fit.fit()
      setSize({ cols: term.cols, rows: term.rows })
      window.roster.pty.resize(sessionId, { cols: term.cols, rows: term.rows })
    }

    fit.fit()
    setSize({ cols: term.cols, rows: term.rows })

    void window.roster.pty
      .open(sessionId, cwd, { cols: term.cols, rows: term.rows })
      .then((info) => {
        if (!disposed) setShell(info.shell.split('/').pop() ?? info.shell)
      })

    const stopData = window.roster.pty.onData((payload) => {
      if (payload.sessionId === sessionId) term.write(payload.data)
    })
    const stopExit = window.roster.pty.onExit((payload) => {
      if (payload.sessionId === sessionId) term.write('\r\n\x1b[38;5;244m[process exited]\x1b[0m\r\n')
    })

    const input = term.onData((data) => window.roster.pty.write(sessionId, data))
    const observer = new ResizeObserver(applyFit)
    observer.observe(container)

    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      stopData()
      stopExit()
      term.dispose()
      // The pty is deliberately left running: switching panes must not kill
      // a long job. It is closed when the session itself is closed.
    }
  }, [sessionId, cwd])

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line bg-term">
      <div className="flex flex-none items-center gap-[10px] border-b border-[#1a1c22] px-[14px] py-[7px]">
        <span className="font-mono text-sm text-[#7d8090]">
          pty · {shell || 'shell'} · {cwdLabel}
        </span>
        <span className="ml-[8px] flex items-center gap-[5px]">
          <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-done" />
          <span className="text-sm text-done">agent attached</span>
        </span>
        <span className="ml-auto font-mono text-sm text-faint-2">
          {size.cols}×{size.rows}
        </span>
      </div>
      <div ref={host} className="min-h-0 flex-1 px-[14px] py-[12px]" />
    </div>
  )
}
