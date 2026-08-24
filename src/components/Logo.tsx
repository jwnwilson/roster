interface LogoProps {
  /** Rendered edge length in px. The mark is drawn on a 16-unit grid. */
  size?: number
}

/**
 * The Roster mark: a roster of rows, the top one amber like a status dot.
 *
 * This is the two-row cut of the app icon in scripts/make-icon.py — three
 * rows stop resolving at 16px, where this is drawn. Keep the geometry in
 * step with that script.
 *
 * The row colours are brand literals rather than status tokens: this amber
 * is the icon's, and the palette's #d9a04a ("needs you") loses too much
 * contrast against the accent at 16px to read as two distinct rows.
 */
export function Logo({ size = 16 }: LogoProps) {
  return (
    <svg
      aria-hidden
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="flex-none"
    >
      <rect x="0.94" y="0.94" width="14.13" height="14.13" rx="3.28" fill="var(--color-accent)" />
      <rect x="3.91" y="5.38" width="8.19" height="1.81" rx="0.91" fill="#ffca70" />
      <rect
        x="3.91"
        y="8.81"
        width="5.56"
        height="1.81"
        rx="0.91"
        fill="#ffffff"
        fillOpacity="0.88"
      />
    </svg>
  )
}
