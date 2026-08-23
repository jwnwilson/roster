import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('electron/main'),
      '@shared': resolve('shared'),
      '@': resolve('src'),
    },
  },
  test: {
    projects: [
      {
        resolve: { alias: { '@main': resolve('electron/main'), '@shared': resolve('shared') } },
        test: { name: 'main', environment: 'node', include: ['tests/main/**/*.test.ts'] },
      },
      {
        resolve: { alias: { '@': resolve('src'), '@shared': resolve('shared') } },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/renderer/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['electron/main/**/*.ts', 'src/**/*.{ts,tsx}', 'shared/**/*.ts'],
      /**
       * Excluded because they can only run inside Electron, and unit-testing
       * them would mean mocking app, BrowserWindow, and ipcMain — which tests
       * the mock, not the code. Both are thin: window creation, and IPC
       * handlers that delegate to stores which are themselves covered. They
       * are exercised for real by the ROSTER_SCRIPT harness against the built
       * app (see the spec's §13).
       */
      exclude: [
        'electron/main/index.ts',
        'electron/main/ipc/index.ts',
        // xterm requires a real canvas and devicePixelRatio, neither of which
        // jsdom provides. Verified against a live shell in the built app.
        'src/terminal/TerminalPane.tsx',
        // A four-line React bootstrap with no branching.
        'src/main.tsx',
      ],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
})
