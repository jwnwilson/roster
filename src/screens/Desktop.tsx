import { useState } from 'react'
import type { DesktopReport, DesktopTestResult } from '@shared/desktop'

export function Desktop() {
  const [report, setReport] = useState<DesktopReport | null>(null)
  const [result, setResult] = useState<DesktopTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function run(action: 'check' | 'request' | 'test'): Promise<void> {
    setBusy(true)
    setError('')
    setNotice('')
    setResult(null)
    try {
      if (action === 'check') setReport(await window.roster.desktop.check())
      else if (action === 'request') {
        await window.roster.desktop.requestAccessibility()
        setNotice('Approve access in System Settings → Privacy & Security → Accessibility for the roster-desktop helper inside Roster.app/Contents/Resources/desktop. Approving only Roster may leave this helper untrusted. Then quit and reopen this Roster build and run the local control test. A prompt request does not mean access was granted.')
      } else setResult(await window.roster.desktop.test())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }
  const button = 'rounded-chip border border-line bg-card px-3 py-2 text-ink disabled:opacity-50'
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6 text-ink">
      <h1 className="text-2xl font-semibold">Local desktop prototype</h1>
      <p>Test keyboard control on this Mac. Roster opens a disposable window, sends native keyboard events to it, reads back the text and shows a screenshot of that window.</p>
      <ol className="list-decimal pl-6 text-muted">
        <li>Request Accessibility access and enable the roster-desktop helper in System Settings.</li>
        <li>Quit and reopen this same Roster build after granting access.</li>
        <li>Run the local control test. Leave its window focused; close it to stop.</li>
      </ol>
      <p className="text-muted">This local experiment uses an ad-hoc signed build. Rebuilding or updating may require granting access again. It does not control another laptop or arbitrary apps. Screen Recording is not needed: the evidence image contains only Roster’s test window.</p>
      <div className="flex flex-wrap gap-3">
        <button className={button} disabled={busy} onClick={() => void run('request')}>Request Accessibility access</button>
        <button className={button} disabled={busy} onClick={() => void run('test')}>Run local control test</button>
        <button className={button} disabled={busy} onClick={() => void run('check')}>Run diagnostics</button>
      </div>
      {busy && <p role="status">Working… If the test window opens, leave it focused.</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {result && <>
        <h2 className="text-xl font-semibold">Local keyboard control verified</h2>
        <p>Read back from the test window: <code>{result.observed}</code></p>
        <img className="max-w-full rounded-chip border border-line" src={result.screenshot} alt="Disposable test window after native keyboard input" />
      </>}
      {report && <>
        <h2 className="text-xl font-semibold">Last diagnostic result</h2>
        <dl className="grid grid-cols-2 gap-3 max-w-xl">
          <dt>Accessibility</dt><dd>{report.accessibilityTrusted ? 'Granted' : 'Not granted'}</dd>
          <dt>Screen Recording</dt><dd>{report.screenCaptureAllowed ? 'Granted' : 'Not granted'}</dd>
          <dt>Keyboard and mouse input</dt><dd>{report.inputPostingAllowed ? 'Granted' : 'Not granted'}</dd>
          <dt>Visible screens</dt><dd>{report.visibleScreens}</dd>
          <dt>Frontmost application</dt><dd>{report.frontmostApp ?? 'Unavailable'}</dd>
        </dl>
        {report.visibleScreens === 0 && <p>No desktop screens are visible to this process.</p>}
        <p className="text-muted">These results apply to this helper in the current launch context. Run the app from your logged-in desktop session. Rerun diagnostics after restarting.</p>
      </>}
    </section>
  )
}
