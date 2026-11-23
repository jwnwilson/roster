import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Markdown } from '@/components/Markdown'
import { installRosterApi } from './rosterApi'

const A = 'data:image/png;base64,AAAA'
const B = 'data:image/png;base64,BBBB'
const C = 'data:image/png;base64,CCCC'

afterEach(() => {
  vi.restoreAllMocks()
})

function carousel() {
  return screen.queryByRole('region', { name: 'Images' })
}

describe('multiple images in a message', () => {
  test('images in one paragraph sit side by side in a carousel', () => {
    installRosterApi()
    render(<Markdown>{`![one](${A}) ![two](${B})`}</Markdown>)

    const region = carousel()
    expect(region).not.toBeNull()
    const slides = within(region!).getAllByRole('group', { name: /slide/i })
    expect(slides).toHaveLength(2)
    expect(within(slides[0]!).getByRole('img', { name: 'one' })).toBeInTheDocument()
    expect(within(slides[1]!).getByRole('img', { name: 'two' })).toBeInTheDocument()
  })

  test('images on consecutive lines become one carousel', () => {
    installRosterApi()
    render(<Markdown>{`![one](${A})\n\n![two](${B})\n\n![three](${C})`}</Markdown>)

    const slides = within(carousel()!).getAllByRole('group', { name: /slide/i })
    expect(slides).toHaveLength(3)
  })

  test('text between images starts a new run', () => {
    installRosterApi()
    render(<Markdown>{`![one](${A})\n\nBetween.\n\n![two](${B})\n\n![three](${C})`}</Markdown>)

    expect(screen.getByText('Between.')).toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: 'Images' })).toHaveLength(1)
    expect(within(carousel()!).getAllByRole('group', { name: /slide/i })).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'one' })).toBeInTheDocument()
  })

  test('a single image is not put in a carousel', () => {
    installRosterApi()
    render(<Markdown>{`![only](${A})`}</Markdown>)

    expect(carousel()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next images' })).toBeNull()
    expect(screen.getByRole('img', { name: 'only' })).toBeInTheDocument()
  })

  test('Next slides the carousel by one image and updates the count', () => {
    installRosterApi()
    render(<Markdown>{`![one](${A})\n\n![two](${B})\n\n![three](${C})`}</Markdown>)
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo')

    expect(screen.getByText('1–2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous images' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next images' }))

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
    expect(screen.getByText('2–3 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next images' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous images' })).toBeEnabled()
  })

  test('each image in a carousel is still magnified on click', () => {
    installRosterApi()
    render(<Markdown>{`![one](${A}) ![two](${B})`}</Markdown>)

    fireEvent.click(screen.getByRole('button', { name: 'Enlarge two' }))

    expect(screen.getByRole('dialog', { name: 'two' })).toBeInTheDocument()
  })
})
