import { render, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Logo } from '@/components/Logo'
import { Sidebar } from '@/components/Sidebar'

describe('Logo', () => {
  test('renders at 16px by default, the size the mark is drawn for', () => {
    const { container } = render(<Logo />)
    const svg = container.querySelector('svg')

    expect(svg?.getAttribute('width')).toBe('16')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16')
  })

  test('scales without redrawing, since it is vector', () => {
    const { container } = render(<Logo size={48} />)

    expect(container.querySelector('svg')?.getAttribute('width')).toBe('48')
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16')
  })

  test('is decorative, so it is hidden from assistive tech', () => {
    const { container } = render(<Logo />)

    // The wordmark next to it already says "Roster".
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  test('draws the accent square and an amber row', () => {
    const { container } = render(<Logo />)
    const fills = [...container.querySelectorAll('rect')].map((r) => r.getAttribute('fill'))

    // The amber matches the app icon, not the "needs you" status token.
    expect(fills).toContain('var(--color-accent)')
    expect(fills).toContain('#ffca70')
  })
})

describe('Sidebar header', () => {
  test('shows the mark beside the wordmark', () => {
    const { container } = render(<Sidebar />)
    const header = container.querySelector('header')

    // Scoped: "Roster" is also the sidebar's agent section label.
    expect(within(header as HTMLElement).getByText('Roster')).toBeInTheDocument()
    expect(header?.querySelector('svg')).toBeInTheDocument()
  })
})
