import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ServerGlyph, hueFor } from '@/components/ServerGlyph'

function glyph(name: string, size?: number): HTMLElement {
  const { container } = render(<ServerGlyph name={name} {...(size ? { size } : {})} />)
  return container.firstElementChild as HTMLElement
}

describe('ServerGlyph', () => {
  test('stamps the server initial', () => {
    expect(glyph('filesystem').textContent).toBe('F')
  })

  test('the same server always gets the same tile', () => {
    // Tiles are recognisable only if they are stable across runs.
    expect(glyph('github').style.background).toBe(glyph('github').style.background)
  })

  test('different servers get different tiles', () => {
    const names = ['github', 'gitlab', 'postgres', 'linear', 'slack']
    const colors = names.map((n) => glyph(n).style.background)

    // Not a guarantee for every pair, but these five must not collapse to one.
    expect(new Set(colors).size).toBeGreaterThan(1)
  })

  test('sizes to the handoff measurements', () => {
    expect(glyph('github').style.width).toBe('22px')
    expect(glyph('github', 20).style.width).toBe('20px')
  })

  test('is decorative, with the name available on hover', () => {
    const el = glyph('filesystem')

    // The card already prints the name; the tile must not repeat it aloud.
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el).toHaveAttribute('title', 'filesystem')
  })

  test('survives a name that starts with punctuation or a digit', () => {
    expect(glyph('3d-render').textContent).toBe('3')
    expect(glyph('_internal').textContent).toBe('_')
  })

  test('falls back rather than rendering an empty tile', () => {
    // A server someone hand-wrote into mcp.json can have any name at all.
    expect(glyph('   ').textContent).toBe('?')
    expect(glyph('').textContent).toBe('?')
  })

  test('a custom server gets a tile too, not a blank square', () => {
    expect(glyph('my-internal-tool').textContent).toBe('M')
    expect(glyph('my-internal-tool').style.background).not.toBe('')
  })
})

describe('ServerGlyph — telling servers apart', () => {
  // Everything the registry offers, plus what a fresh install seeds.
  const SHIPPED = [
    'filesystem', 'github', 'gitlab', 'sentry', 'postgres',
    'sqlite', 'bigquery', 'linear', 'slack', 'notion',
  ]

  test('no two shipped servers share both a letter and a colour', () => {
    const seen = SHIPPED.map((name) => {
      const el = glyph(name)
      return `${el.textContent}|${el.style.background}`
    })

    // github/gitlab is the pair that collides at several bucket counts.
    expect(new Set(seen).size).toBe(SHIPPED.length)
  })

  test('tiles that do share a colour match exactly rather than nearly', () => {
    // A near-miss of a few degrees reads as a rendering fault; hues are
    // quantized so two tiles are either plainly equal or plainly apart.
    for (const name of SHIPPED) expect(hueFor(name) % 36).toBe(0)
  })

  test('a hue is always a usable angle', () => {
    for (const name of [...SHIPPED, '', '   ', 'my-internal-tool']) {
      expect(hueFor(name)).toBeGreaterThanOrEqual(0)
      expect(hueFor(name)).toBeLessThan(360)
    }
  })
})
