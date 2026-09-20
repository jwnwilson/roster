import { Logo } from './Logo'

/**
 * The window's own title bar, spanning its full width.
 *
 * `frame: false` removes the native frame (electron/main/index.ts), so this
 * bar is the entire window chrome: the only region that moves the window and
 * the only place the controls live. It sits above the rail and the screen
 * rather than inside either, because a bar only as wide as the sidebar gives
 * you a few hundred pixels to grab a 1440px window by.
 */
export function TitleBar() {
  return (
    <header
      className="flex h-header flex-none items-center gap-[10px] border-b border-line bg-rail px-[14px]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <WindowControls />
      <Logo />
      <span className="font-semibold tracking-[-0.01em]">Roster</span>
    </header>
  )
}

/**
 * The three dots, at the leading edge where macOS puts its traffic lights.
 *
 * In a no-drag wrapper without exception: a button inside a drag region is
 * swallowed by the drag, so the window moves and the click never lands.
 */
function WindowControls() {
  // The traffic-light convention, in the app's own palette rather than
  // macOS's saturated one, which would shout next to everything else here.
  // Colour alone does not identify a button, so each keeps its label and
  // gains a tooltip.
  const controls = [
    {
      label: 'Close window',
      color: 'var(--color-error)',
      action: () => window.roster.window.close(),
    },
    {
      label: 'Minimize window',
      color: 'var(--color-amber)',
      action: () => window.roster.window.minimize(),
    },
    {
      label: 'Maximize window',
      color: 'var(--color-done)',
      action: () => window.roster.window.maximize(),
    },
  ]

  return (
    <div
      className="flex flex-none gap-[5px]"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {controls.map((control) => (
        <button
          key={control.label}
          type="button"
          aria-label={control.label}
          title={control.label}
          onClick={control.action}
          style={{ background: control.color }}
          className="h-[9px] w-[9px] cursor-pointer rounded-full border-0 p-0 opacity-85 hover:opacity-100"
        />
      ))}
    </div>
  )
}
