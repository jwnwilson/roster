import { useState } from 'react'
import type { DesktopReport } from '@shared/desktop'

export function Desktop() {
  const [report, setReport] = useState<DesktopReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(): Promise<void> {
    setBusy(true)
    setError('')
    setReport(null)
    try {
      setReport(await window.roster.desktop.check())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }
  const button = 'rounded-chip border border-line bg-card px-3 py-2 text-ink disabled:opacity-50'
  return (
    <section className="flex flex-col gap-4 overflow-y-auto p-6 text-ink">
      <h1 className="text-2xl font-semibold">Desktop diagnostics</h1>
      <p>Check whether Roster’s macOS helper can see the desktop and has the relevant permissions.</p>
      <p className="text-muted">This check reads permissions, screen count and the frontmost app name. It does not capture screenshots or send keyboard or mouse input.</p>
      <p className="text-muted">Developer diagnostics: current releases lack a stable Developer ID signing identity. Permission grants may not persist across updates. Permission requests and agent desktop control are not available here.</p>
      <div><button className={button} disabled={busy} onClick={() => void run()}>Run diagnostics</button></div>
      {busy && <p role="status">Checking desktop access…</p>}
      {error && <p role="alert">{error}</p>}
      {report && <>
        <dl className="grid grid-cols-2 gap-3 max-w-xl">
          <dt>Accessibility</dt><dd>{report.accessibilityTrusted ? 'Granted' : 'Not granted'}</dd>
          <dt>Screen Recording</dt><dd>{report.screenCaptureAllowed ? 'Granted' : 'Not granted'}</dd>
          <dt>Keyboard and mouse input</dt><dd>{report.inputPostingAllowed ? 'Granted' : 'Not granted'}</dd>
          <dt>Visible screens</dt><dd>{report.visibleScreens}</dd>
          <dt>Frontmost application</dt><dd>{report.frontmostApp ?? 'Unavailable'}</dd>
        </dl>
        {report.visibleScreens === 0 && <p>No desktop screens are visible to this process.</p>}
        <p className="text-muted">Permission results apply to this helper in the current launch context. Run the installed Roster app in your logged-in desktop session. After changing permissions in System Settings, quit and reopen Roster, then run diagnostics again.</p>
      </>}
    </section>
  )
}
