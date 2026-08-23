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

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}
