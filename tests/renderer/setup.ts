import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest does not enable RTL's automatic cleanup unless `globals` is on, and
// without it each render leaks into the next test's DOM.
afterEach(cleanup)

// jsdom implements neither of these, and assistant-ui's viewport uses both.
// A no-op is enough: layout is not what these tests assert on.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}

// jsdom implements no scrolling at all, and assistant-ui's viewport calls
// these while auto-scrolling. Left unstubbed they surface as unhandled
// errors, which fail the run even when every test passes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo(): void {}
}

if (!Element.prototype.scrollBy) {
  Element.prototype.scrollBy = function scrollBy(): void {}
}

// Node defines its own `localStorage` global, which shadows jsdom's and does
// nothing at all unless the process was started with `--localstorage-file`.
// An in-memory stand-in restores the one behaviour the renderer wants from
// it: what was written can be read back.
if (typeof window.localStorage?.getItem !== 'function') {
  const entries = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
    },
  })
}
