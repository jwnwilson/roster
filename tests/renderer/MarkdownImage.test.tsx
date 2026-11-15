import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Markdown } from '@/components/Markdown'
import { installRosterApi } from './rosterApi'

describe('images in Markdown', () => {
  test('an embedded PNG renders as an image with its alt text', () => {
    installRosterApi()
    render(<Markdown>{'![the chart](data:image/png;base64,iVBORw0KGgo=)'}</Markdown>)

    const img = screen.getByRole('img', { name: 'the chart' })
    expect(img).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')
    expect(screen.getByText('the chart')).toBeInTheDocument()
  })

  test('a local image path is loaded through the main process', async () => {
    const readImage = vi.fn().mockResolvedValue('data:image/png;base64,AAAA')
    installRosterApi({ files: { readImage } })
    render(<Markdown>{'![shot](/Users/noel/shot.png)'}</Markdown>)

    expect(readImage).toHaveBeenCalledWith('/Users/noel/shot.png')
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'shot' })).toHaveAttribute(
        'src',
        'data:image/png;base64,AAAA',
      ),
    )
  })

  test('a local path that cannot be read shows a placeholder, not a broken image', async () => {
    installRosterApi({ files: { readImage: vi.fn().mockResolvedValue(null) } })
    render(<Markdown>{'![shot](/Users/noel/gone.png)'}</Markdown>)

    expect(await screen.findByText('[image not available: shot]')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  test('a remote image is not loaded and is offered as a link', () => {
    installRosterApi()
    const { container } = render(<Markdown>{'![diagram](https://example.com/d.png)'}</Markdown>)

    expect(container.querySelector('img')).toBeNull()
    const link = screen.getByRole('link', { name: 'diagram' })
    expect(link).toHaveAttribute('href', 'https://example.com/d.png')
  })

  test('an image that fails to decode falls back to the placeholder', () => {
    installRosterApi()
    render(<Markdown>{'![broken](data:image/png;base64,%%%)'}</Markdown>)

    const img = screen.getByRole('img', { name: 'broken' })
    fireEvent.error(img)

    expect(screen.getByText('[image not available: broken]')).toBeInTheDocument()
  })

  test('every image is shown at the same size, half the window height at most', () => {
    installRosterApi()
    render(
      <Markdown>{'![tall](data:image/png;base64,AAAA)\n\n![wide](data:image/png;base64,BBBB)'}</Markdown>,
    )

    const frames = screen.getAllByRole('button', { name: /^Enlarge / })
    expect(frames).toHaveLength(2)
    for (const frame of frames) expect(frame.className).toContain('h-[50vh]')
  })

  test('clicking an image opens it magnified in a dialog', () => {
    installRosterApi()
    render(<Markdown>{'![the chart](data:image/png;base64,AAAA)'}</Markdown>)

    fireEvent.click(screen.getByRole('button', { name: 'Enlarge the chart' }))

    const dialog = screen.getByRole('dialog', { name: 'the chart' })
    expect(within(dialog).getByRole('img', { name: 'the chart' })).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    )
  })

  test('Escape closes the magnified image', () => {
    installRosterApi()
    render(<Markdown>{'![the chart](data:image/png;base64,AAAA)'}</Markdown>)

    fireEvent.click(screen.getByRole('button', { name: 'Enlarge the chart' }))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
