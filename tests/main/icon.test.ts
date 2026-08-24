import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The icon is generated (scripts/make-icon.py) but committed, so a build
 * machine without Python still gets it. These guard against it being lost.
 */
describe('app icon', () => {
  test('the generated files are present', () => {
    expect(existsSync(join(ROOT, 'build/icon.png'))).toBe(true)
    expect(existsSync(join(ROOT, 'build/icon.icns'))).toBe(true)
  })

  test('the icns carries every size macOS asks for', () => {
    // A truncated iconset still produces a valid file, just a blurry dock.
    expect(statSync(join(ROOT, 'build/icon.icns')).size).toBeGreaterThan(64 * 1024)
  })

  test('the png is the full 1024 canvas', () => {
    // PNG IHDR: width and height are big-endian at bytes 16 and 20.
    const header = readFileSync(join(ROOT, 'build/icon.png')).subarray(0, 24)
    expect(header.readUInt32BE(16)).toBe(1024)
    expect(header.readUInt32BE(20)).toBe(1024)
  })

  test('the packaged build points at them', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      build: { mac: { icon: string }; win: { icon: string }; linux: { icon: string } }
    }

    expect(pkg.build.mac.icon).toBe('build/icon.icns')
    expect(pkg.build.win.icon).toBe('build/icon.png')
    expect(pkg.build.linux.icon).toBe('build/icon.png')
  })
})

describe('dev dock icon', () => {
  test('the path the main process builds resolves to the icon', () => {
    // electron/main/index.ts joins '../../build/icon.png' onto its own dir,
    // which after bundling is out/main — an easy thing to get one level wrong.
    const fromBuiltMain = join(ROOT, 'out/main', '../../build/icon.png')

    expect(existsSync(fromBuiltMain)).toBe(true)
  })
})
