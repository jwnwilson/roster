import type { ReactNode } from 'react'
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
}

export function ToggleChip({
  label,
  on,
  onToggle,
  dotShape = 'square',
  mono = false,
}: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={on}
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
