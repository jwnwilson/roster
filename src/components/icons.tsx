/**
 * Icons shared across screens.
 *
 * They live here rather than beside their first caller once a second one
 * needs them — an SVG copied into two files drifts the first time the mark
 * is adjusted in one of them.
 */

export function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.75 4.25h10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M4 4.25 4.6 13a.75.75 0 0 0 .75.7h5.3a.75.75 0 0 0 .75-.7l.6-8.75"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M6.75 6.75v4.5M9.25 6.75v4.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}
