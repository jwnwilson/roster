import type { ReactNode } from 'react'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
}

/** Handoff § Skills: 46px gutter, monospace 12.5px/1.75. */
const GUTTER_WIDTH = 46
const LINE_HEIGHT = 1.75
const PAD_Y = 14
const PAD_X = 20

/**
 * A line-numbered, markdown-coloured editor.
 *
 * The design specifies a coloured code view, but this file is editable — and
 * a `<textarea>` cannot colour its own contents. So the coloured text is a
 * `<pre>` and the textarea sits transparently on top of it, contributing the
 * caret, selection and typing while the `<pre>` underneath contributes the
 * colour.
 *
 * The two must agree on every metric that affects where a glyph lands, which
 * is why the font, size, line height and padding below are shared rather
 * than written twice. Both layers live inside one scrolling container and
 * the `<pre>` sizes it, so there is no scroll position to keep in sync.
 */
export function CodeEditor({ value, onChange, ariaLabel }: CodeEditorProps) {
  const lines = value.split('\n')

  const metrics = {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-lg)',
    lineHeight: LINE_HEIGHT,
  } as const

  return (
    <div className="relative min-h-0 flex-1 overflow-auto">
      <div className="flex min-h-full min-w-full">
        <div
          aria-hidden
          className="flex-none text-right text-faint-2 select-none"
          style={{
            ...metrics,
            width: GUTTER_WIDTH,
            padding: `${PAD_Y}px 10px ${PAD_Y}px 0`,
          }}
        >
          {lines.map((_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Sizes the column, and carries the colour. */}
          <pre
            aria-hidden
            className="m-0 whitespace-pre-wrap text-ink-2"
            style={{ ...metrics, padding: `${PAD_Y}px ${PAD_X}px` }}
          >
            {lines.map((line, index) => (
              <div key={index}>{colourLine(line)}</div>
            ))}
          </pre>

          <textarea
            value={value}
            aria-label={ariaLabel}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            // Transparent text over the pre; the caret stays visible so the
            // thing you type into still looks like an input.
            className="absolute inset-0 h-full w-full resize-none overflow-hidden border-0 bg-transparent whitespace-pre-wrap text-transparent caret-ink outline-none"
            style={{ ...metrics, padding: `${PAD_Y}px ${PAD_X}px` }}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * The handoff's markdown colouring: headers bold white, code spans purple,
 * list items light grey. Anything else keeps the body colour.
 *
 * Deliberately line-based and shallow — this is syntax colour for a file
 * you are editing, not a Markdown renderer. Nothing here reflows or hides
 * a character, so what you see is what is in the file.
 */
export function colourLine(line: string): ReactNode {
  if (line === '') return '\n'

  if (/^#{1,6} /.test(line)) {
    return <span className="font-bold text-ink">{splitCode(line)}</span>
  }

  if (/^\s*([-*+]|\d+\.) /.test(line)) {
    return <span className="text-ink-3">{splitCode(line)}</span>
  }

  return splitCode(line)
}

/** Wraps every `backticked` run in the accent, leaving the rest alone. */
function splitCode(line: string): ReactNode {
  if (!line.includes('`')) return line

  // Split on backtick pairs; odd indices are what sat between them.
  const parts = line.split(/`([^`]*)`/g)

  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="text-accent-light">
        `{part}`
      </span>
    ) : (
      part
    ),
  )
}
