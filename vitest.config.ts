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
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
})
