import { useRoster } from '@/state/store'

/**
 * The sidebar's update prompt.
 *
 * Roster ships unsigned, so it cannot install over itself — the flow ends at
 * an opened DMG, not a restart. The wording says so rather than promising a
 * one-click update it cannot deliver.
 *
 * Sits above the workspace footer and renders nothing at all when there is
 * nothing to say, so the sidebar is unchanged in the common case.
 */
export function UpdateRow() {
  const update = useRoster((s) => s.update)

  // 'checking' is deliberately silent too: the launch check runs on every
  // start, and a row that flickers in and out on boot is worse than nothing.
  if (update.status === 'idle' || update.status === 'current' || update.status === 'checking') {
    return null
  }

  return (
    <div className="flex flex-none flex-col gap-[7px] border-t border-amber-line bg-amber-surface px-[10px] py-[9px]">
      <div className="flex items-center gap-[8px]">
        <span
          aria-hidden
          className="h-[6px] w-[6px] flex-none rounded-full"
          style={{ background: 'var(--color-amber)' }}
        />
        <span className="truncate text-md text-amber-text">{label(update)}</span>
      </div>

      {update.status === 'downloading' ? (
        <div
          aria-hidden
          className="h-[4px] overflow-hidden rounded-[2px] bg-amber-line"
        >
          <div
            className="h-full rounded-[2px]"
            style={{ width: `${update.percent}%`, background: 'var(--color-amber)' }}
          />
        </div>
      ) : (
        <Action update={update} />
      )}
    </div>
  )
}

type Update = ReturnType<typeof useRoster.getState>['update']

/**
 * The states that actually draw a row. Narrowing here rather than defaulting
 * in each switch means TypeScript proves the cases are covered, instead of
 * both functions carrying an arm that can never run.
 */
type VisibleUpdate = Extract<
  Update,
  { status: 'available' | 'downloading' | 'ready' | 'error' }
>

function label(update: VisibleUpdate): string {
  switch (update.status) {
    case 'available':
      return `Version ${update.version} available`
    case 'downloading':
      return `Downloading ${update.version}… ${update.percent}%`
    case 'ready':
      return `${update.version} ready to install`
    case 'error':
      return update.message
  }
}

function Action({ update }: { update: Exclude<VisibleUpdate, { status: 'downloading' }> }) {
  switch (update.status) {
    case 'available':
      return (
        <UpdateButton onClick={() => void window.roster.update.download()}>Download</UpdateButton>
      )
    case 'ready':
      return (
        <>
          <UpdateButton onClick={() => void window.roster.update.install()}>
            Open installer
          </UpdateButton>
          <p className="m-0 text-xs text-amber-text opacity-70">
            Drag Roster to Applications.
          </p>
        </>
      )
    case 'error':
      return <UpdateButton onClick={() => void window.roster.update.check()}>Retry</UpdateButton>
  }
}

/**
 * Filled amber rather than the app's purple PrimaryButton: this row is the
 * same "needs you" register as the approval banner, and a purple action
 * inside an amber surface reads as belonging to something else.
 */
function UpdateButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-chip border-0 bg-amber px-[11px] py-[4px] font-ui text-md font-semibold text-amber-ink hover:bg-amber-hover"
    >
      {children}
    </button>
  )
}
