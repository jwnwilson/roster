import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { TitleBar } from '@/components/TitleBar'
import { installRosterApi } from './rosterApi'

/**
 * The window's own chrome.
 *
 * `frame: false` removes the native frame, so this bar is the only thing that
 * moves the window and these three dots are the only controls — which makes
 * the drag regions load-bearing rather than cosmetic.
 */

beforeEach(() => {
  installRosterApi()
})

/**
 * The app-region an element declares, or its nearest ancestor that declares
 * one.
 *
 * Read off `style` rather than the style attribute: jsdom does not serialise
 * `-webkit-app-region` into the attribute, though it stores the value. The
 * inline style is what Electron reads in the real window, so this is the
 * thing worth asserting on.
 */
function appRegion(el: HTMLElement | null): string {
  for (let node = el; node !== null; node = node.parentElement) {
    const region = (node.style as unknown as Record<string, string>)['WebkitAppRegion']
    if (region) return region
  }
  return ''
}

const CONTROLS = [
  ['Minimize window', 'var(--color-amber)'],
  ['Maximize window', 'var(--color-done)'],
  ['Close window', 'var(--color-error)'],
] as const

describe('the title bar', () => {
  test('shows the mark beside the wordmark', () => {
    const { container } = render(<TitleBar />)
    const header = container.querySelector('header')

    expect(within(header as HTMLElement).getByText('Roster')).toBeInTheDocument()
    expect(header?.querySelector('svg')).toBeInTheDocument()
  })

  test('is a drag region, because nothing else moves the window', () => {
    const { container } = render(<TitleBar />)

    expect(appRegion(container.querySelector('header'))).toBe('drag')
  })

  test('but the controls are not, or they could not be clicked', () => {
    // A button inside a drag region is swallowed by the drag: the window
    // moves and the click never lands. This is the whole reason the dots sit
    // in a no-drag wrapper.
    render(<TitleBar />)
    const dot = screen.getByRole('button', { name: 'Close window' })

    expect(appRegion(dot)).toBe('no-drag')
  })

  test('puts the controls before the wordmark, as macOS does', () => {
    const { container } = render(<TitleBar />)
    const header = container.querySelector('header') as HTMLElement
    const dot = screen.getByRole('button', { name: 'Close window' })
    const wordmark = within(header).getByText('Roster')

    // Node.compareDocumentPosition: FOLLOWING means the wordmark comes after.
    expect(dot.compareDocumentPosition(wordmark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('the window controls', () => {
  test.each(CONTROLS)('%s is colour coded', (label, color) => {
    render(<TitleBar />)

    expect(screen.getByRole('button', { name: label })).toHaveStyle({ background: color })
  })

  test('each is distinguishable by more than colour', () => {
    render(<TitleBar />)

    for (const [label] of CONTROLS) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('title', label)
    }
  })

  test('no two controls share a colour', () => {
    render(<TitleBar />)
    const colors = CONTROLS.map(
      ([label]) => screen.getByRole('button', { name: label }).style.background,
    )

    expect(new Set(colors).size).toBe(CONTROLS.length)
  })

  test('they still do what they say', async () => {
    const user = userEvent.setup()
    render(<TitleBar />)

    await user.click(screen.getByRole('button', { name: 'Close window' }))

    expect(window.roster.window.close).toHaveBeenCalled()
    expect(window.roster.window.minimize).not.toHaveBeenCalled()
  })
})

describe('the sidebar', () => {
  test('no longer carries window chrome of its own', async () => {
    const { Sidebar } = await import('@/components/Sidebar')
    render(<Sidebar />)

    // Two sets of controls would be two ways to close the window, and the
    // bar is now the one that spans the window.
    expect(screen.queryByRole('button', { name: 'Close window' })).not.toBeInTheDocument()
  })
})
