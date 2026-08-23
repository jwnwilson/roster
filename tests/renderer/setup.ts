import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest does not enable RTL's automatic cleanup unless `globals` is on, and
// without it each render leaks into the next test's DOM.
afterEach(cleanup)
