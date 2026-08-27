import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { CodeEditor } from '@/components/CodeEditor'

function gutterNumbers(container: HTMLElement): string[] {
  const gutter = container.querySelector('[aria-hidden]')
  return [...(gutter?.children ?? [])].map((child) => child.textContent ?? '')
}

describe('CodeEditor — the gutter', () => {
  test('numbers every line from one', () => {
    const { container } = render(
      <CodeEditor value={'first\nsecond\nthird'} onChange={vi.fn()} ariaLabel="File" />,
    )

    expect(gutterNumbers(container)).toEqual(['1', '2', '3'])
  })

  test('counts a blank line, so numbering keeps matching the file', () => {
    const { container } = render(
      <CodeEditor value={'first\n\nthird'} onChange={vi.fn()} ariaLabel="File" />,
    )

    expect(gutterNumbers(container)).toEqual(['1', '2', '3'])
  })

  test('numbers a single empty file as line one', () => {
    const { container } = render(<CodeEditor value="" onChange={vi.fn()} ariaLabel="File" />)

    expect(gutterNumbers(container)).toEqual(['1'])
  })
})

describe('CodeEditor — editing', () => {
  test('is a real input, not a read-only view', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CodeEditor value="" onChange={onChange} ariaLabel="Skill file contents" />)

    await user.type(screen.getByLabelText('Skill file contents'), 'x')

    expect(onChange).toHaveBeenCalledWith('x')
  })

  test('shows the file contents in the textarea, not just in the backdrop', () => {
    render(<CodeEditor value="# Title" onChange={vi.fn()} ariaLabel="File" />)

    expect(screen.getByLabelText('File')).toHaveValue('# Title')
  })
})

describe('CodeEditor — markdown colouring', () => {
  /** The coloured backdrop is the `pre`; the gutter is the other aria-hidden. */
  function backdrop(container: HTMLElement): HTMLElement {
    return container.querySelector('pre') as HTMLElement
  }

  test('renders headers bold and white', () => {
    const { container } = render(
      <CodeEditor value="## When to use" onChange={vi.fn()} ariaLabel="File" />,
    )

    const span = backdrop(container).querySelector('span')
    expect(span?.className).toContain('font-bold')
    expect(span?.className).toContain('text-ink')
  })

  test('renders list items in the lighter grey', () => {
    const { container } = render(
      <CodeEditor value="- a point" onChange={vi.fn()} ariaLabel="File" />,
    )

    expect(backdrop(container).querySelector('span')?.className).toContain('text-ink-3')
  })

  test('treats numbered and indented list items as list items too', () => {
    const { container } = render(
      <CodeEditor value={'1. first\n   - nested'} onChange={vi.fn()} ariaLabel="File" />,
    )

    const spans = backdrop(container).querySelectorAll('span')
    expect(spans).toHaveLength(2)
    for (const span of spans) expect(span.className).toContain('text-ink-3')
  })

  test('renders code spans in the accent', () => {
    const { container } = render(
      <CodeEditor value="run `pytest -k leak` first" onChange={vi.fn()} ariaLabel="File" />,
    )

    const accent = backdrop(container).querySelector('.text-accent-light')
    expect(accent?.textContent).toBe('`pytest -k leak`')
  })

  test('keeps the backticks visible — nothing is hidden from the file', () => {
    const { container } = render(
      <CodeEditor value="a `b` c" onChange={vi.fn()} ariaLabel="File" />,
    )

    // This is an editor, not a renderer: what you see must be what is on disk.
    expect(backdrop(container).textContent).toBe('a `b` c')
  })

  test('colours a code span inside a header without losing the header', () => {
    const { container } = render(
      <CodeEditor value="# Use `npx`" onChange={vi.fn()} ariaLabel="File" />,
    )

    const outer = backdrop(container).querySelector('span')
    expect(outer?.className).toContain('font-bold')
    expect(outer?.querySelector('.text-accent-light')?.textContent).toBe('`npx`')
  })

  test('leaves plain prose alone', () => {
    const { container } = render(
      <CodeEditor value="just a sentence" onChange={vi.fn()} ariaLabel="File" />,
    )

    expect(backdrop(container).querySelectorAll('span')).toHaveLength(0)
  })

  test('an unpaired backtick is left as text rather than colouring the rest', () => {
    const { container } = render(
      <CodeEditor value="a ` dangling" onChange={vi.fn()} ariaLabel="File" />,
    )

    expect(backdrop(container).querySelector('.text-accent-light')).toBeNull()
    expect(backdrop(container).textContent).toBe('a ` dangling')
  })

  test('colours a non-markdown file as plain text', () => {
    const { container } = render(
      <CodeEditor value={'def main():\n    return 1'} onChange={vi.fn()} ariaLabel="File" />,
    )

    expect(backdrop(container).querySelectorAll('span')).toHaveLength(0)
  })
})
