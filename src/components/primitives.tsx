import { useEffect, type ReactNode } from 'react'
import type { Status } from '@shared/types'
import { statusColor } from '@shared/status'

/* -------------------------------------------------------------------------
 * Small shared pieces. Each exists because the design repeats it verbatim
 * across screens, not to be generic for its own sake.
 * ---------------------------------------------------------------------- */

interface StatusDotProps {
  status: Status
  /** Diameter in px — the design uses 5, 6, and 7 in different places. */
  size?: number
}

export function StatusDot({ status, size = 6 }: StatusDotProps) {
  return (
    <span
      aria-hidden
      className="flex-none rounded-full"
      style={{ width: size, height: size, background: statusColor(status) }}
    />
  )
}

interface SectionLabelProps {
  children: ReactNode
  className?: string
}

/** 10.5px uppercase with 0.07em tracking — used on every rail section. */
export function SectionLabel({ children, className = '' }: SectionLabelProps) {
  return (
    <div
      className={`text-xs font-semibold uppercase tracking-[0.07em] text-label ${className}`}
    >
      {children}
    </div>
  )
}

interface ScreenHeaderProps {
  title: string
  children?: ReactNode
}

/** The 44px header every screen opens with. */
export function ScreenHeader({ title, children }: ScreenHeaderProps) {
  return (
    <header
      className="flex h-header flex-none items-center gap-[10px] border-b border-line px-[18px]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
      <div
        className="flex flex-1 items-center gap-[10px]"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {children}
      </div>
    </header>
  )
}

interface FieldProps {
  label: string
  children: ReactNode
  trailing?: ReactNode
  caption?: string
}

/** A labelled form field — 7px gap within, per the handoff. */
export function Field({ label, children, trailing, caption }: FieldProps) {
  return (
    <div className="flex flex-col gap-[7px]">
      <div className="flex items-center">
        <span className="text-md font-medium text-muted">{label}</span>
        {trailing ? <div className="ml-auto">{trailing}</div> : null}
      </div>
      {children}
      {caption ? <p className="m-0 text-sm text-faint">{caption}</p> : null}
    </div>
  )
}

interface TextInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  ariaLabel: string
}

export function TextInput({
  value,
  onChange,
  placeholder,
  className = '',
  ariaLabel,
}: TextInputProps) {
  return (
    <input
      type="text"
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-chip border border-line-input bg-card px-[10px] py-[5px] text-md text-ink outline-none placeholder:text-faint focus:border-accent-line focus:bg-accent-surface-2 ${className}`}
    />
  )
}

interface PrimaryButtonProps {
  onClick: () => void
  children: ReactNode
}

export function PrimaryButton({ onClick, children }: PrimaryButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-chip border-0 bg-accent px-[11px] py-[5px] font-ui text-md font-semibold text-white hover:bg-accent-hover"
    >
      {children}
    </button>
  )
}

interface GhostButtonProps {
  onClick: () => void
  children: ReactNode
}

export function GhostButton({ onClick, children }: GhostButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-chip border border-line-input bg-transparent px-[11px] py-[5px] font-ui text-md text-muted hover:border-line-hover"
    >
      {children}
    </button>
  )
}

interface IconButtonProps {
  /** Both the accessible name and the tooltip — an icon has no text of its own. */
  label: string
  onClick: () => void
  children: ReactNode
  /** Reddens on hover, so a destructive action never looks like the others. */
  destructive?: boolean
}

/** A bare glyph that acts on the row or panel it sits in. */
export function IconButton({ label, onClick, children, destructive = false }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex cursor-pointer items-center justify-center rounded-[3px] border-0 bg-transparent p-[3px] text-dim hover:bg-[#24262f] ${
        destructive ? 'hover:text-error' : 'hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}

/** The Chat/Terminal and Installed/Registry toggle. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex gap-[2px] rounded-pill border border-line-input bg-card p-[2px]"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`cursor-pointer rounded-sm border-0 px-[11px] py-[4px] font-ui text-md font-medium ${
              active ? 'bg-accent-surface-3 text-ink' : 'bg-transparent text-muted-2'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

interface ToggleChipProps {
  label: string
  on: boolean
  onToggle: () => void
  /** Skills use a rounded square dot; MCP servers use a circle. */
  dotShape?: 'square' | 'circle'
  mono?: boolean
  /**
   * Overrides the accessible name. Needed when the visible label is the state
   * itself ("Shown" / "Hidden") rather than what the control acts on, which
   * would otherwise read as "Shown, pressed".
   */
  ariaLabel?: string
}

export function ToggleChip({
  label,
  on,
  onToggle,
  dotShape = 'square',
  mono = false,
  ariaLabel,
}: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
      {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
      onClick={onToggle}
      className={`flex cursor-pointer items-center gap-[7px] rounded-[20px] border px-[11px] py-[6px] text-md ${
        on
          ? 'border-accent-line bg-accent-surface text-accent-text'
          : 'border-line-card bg-transparent text-muted-2'
      } ${mono ? 'font-mono' : 'font-ui'}`}
    >
      <span
        aria-hidden
        className={dotShape === 'circle' ? 'rounded-full' : 'rounded-[1.5px]'}
        style={{
          width: 5,
          height: 5,
          background: on ? 'var(--color-accent)' : 'var(--color-off)',
        }}
      />
      {label}
    </button>
  )
}

interface SelectOption<T extends string> {
  value: T
  label: string
}

interface SelectProps<T extends string> {
  options: readonly SelectOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
  /**
   * The backlog sidebar's tighter metrics: two of these share 220px, and at
   * the usual size "All priorities" does not fit in half of it.
   */
  compact?: boolean
}

/**
 * The handoff's styled dropdown: a real `<select>` with the app's chrome and
 * its own chevron, since the native one cannot be themed.
 *
 * Native rather than a custom popover on purpose — keyboard handling, type-
 * ahead and screen-reader semantics all come for free, and the design asks
 * for a select rather than a menu.
 */
export function Select<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
  compact = false,
}: SelectProps<T>) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value as T)}
        className={`w-full cursor-pointer appearance-none rounded-chip border border-line-input bg-card font-ui text-ink-3 outline-none hover:border-line-hover-strong focus:border-accent-line ${
          compact ? 'py-[5px] pr-[20px] pl-[8px] text-base' : 'py-[5px] pr-[26px] pl-[10px] text-md'
        }`}
        data-hoverable
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[9px] text-dim ${
          compact ? 'right-[7px]' : 'right-[9px]'
        }`}
      >
        ▾
      </span>
    </div>
  )
}

interface ModalProps {
  /** Names the dialog for screen readers. */
  label: string
  onClose: () => void
  header: ReactNode
  footer?: ReactNode
  children: ReactNode
  /** The design uses 520px for forms and 800px for the task detail. */
  maxWidth?: number
  /** The task modal is a fixed-height two-column layout, not a form. */
  fixedHeight?: boolean
  /**
   * A floor for the card's height, in px.
   *
   * A modal listing things sized to its contents jumps every time the list
   * changes underneath it — paging, filtering, opening a row's editor — and
   * moves its own buttons out from under the pointer. A floor holds it still
   * without pinning it the way `fixedHeight` does, so a long list can still
   * grow to the viewport.
   */
  minHeight?: number
}

/**
 * The overlay every modal in the app shares.
 *
 * Extracted once there were five of these: the scrim, the backdrop-click
 * check, Escape, and the header/body/footer bands were being retyped each
 * time, and had already drifted — one modal closed on Escape and another
 * did not.
 */
export function Modal({
  label,
  onClose,
  header,
  footer,
  children,
  maxWidth = 520,
  fixedHeight = false,
  minHeight,
}: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-40 flex items-center justify-center px-[24px] py-[32px]"
      style={{ background: 'rgba(6,7,10,0.66)' }}
      onClick={(e) => {
        // Only the backdrop itself closes — a click that started inside the
        // card and drifted out must not.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex w-full flex-col overflow-hidden rounded-modal border border-line-card bg-app shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
        style={{
          maxWidth,
          ...(fixedHeight
            ? { height: 'min(680px, 100%)' }
            : {
                maxHeight: '100%',
                // Capped at the viewport as well, or the floor would push the
                // card off a short screen.
                ...(minHeight === undefined ? {} : { minHeight: `min(${minHeight}px, 100%)` }),
              }),
        }}
      >
        <header className="flex flex-none items-center gap-[10px] border-b border-line px-[18px] py-[13px]">
          {header}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-ui text-[15px] leading-none text-dim hover:text-ink"
            data-hoverable
          >
            ×
          </button>
        </header>

        {children}

        {footer ? (
          <footer className="flex flex-none items-center gap-[10px] border-t border-line bg-sunken px-[18px] py-[13px]">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
