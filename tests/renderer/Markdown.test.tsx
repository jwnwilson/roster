import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Markdown } from '@/components/Markdown'

describe('Markdown', () => {
  test('renders headings at each level the design uses', () => {
    render(<Markdown>{'# One\n\n## Two\n\n### Three'}</Markdown>)

    expect(screen.getByRole('heading', { level: 1, name: 'One' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Two' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Three' })).toBeInTheDocument()
  })

  test('renders bold and inline code', () => {
    const { container } = render(<Markdown>{'**bold** and `code`'}</Markdown>)

    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('code')?.textContent).toBe('code')
  })

  test('renders list items', () => {
    render(<Markdown>{'- first\n- second'}</Markdown>)

    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'first',
      'second',
    ])
  })

  test('renders a fenced code block, which the prototype parser could not', () => {
    const { container } = render(<Markdown>{'```py\nprint(1)\n```'}</Markdown>)

    const pre = container.querySelector('pre')
    expect(pre?.textContent).toContain('print(1)')
  })

  test('renders a GFM table', () => {
    render(<Markdown>{'| a | b |\n| --- | --- |\n| 1 | 2 |'}</Markdown>)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'a' })).toBeInTheDocument()
  })

  test('opens links away from the app, and safely', () => {
    render(<Markdown>{'[docs](https://example.com)'}</Markdown>)

    const link = screen.getByRole('link', { name: 'docs' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  test('does not execute raw HTML, since agents write this text', () => {
    const { container } = render(
      <Markdown>{'<script>window.pwned = true</script><b>hi</b>'}</Markdown>,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('hi')
  })

  test('renders nothing visible for empty input', () => {
    const { container } = render(<Markdown>{''}</Markdown>)
    expect(container.textContent).toBe('')
  })
})
