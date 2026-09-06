import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        /**
         * Two entries, not one. `mcpStdio` is the MCP server `codex exec`
         * spawns to reach Roster's tools, so it has to exist as its own file
         * on disk beside the main bundle — the bridge points the child at
         * `mcpStdio.js` next to itself. Entry names are fixed so that path is
         * predictable in a dev run and inside a packaged app alike.
         */
        input: {
          index: resolve('electron/main/index.ts'),
          mcpStdio: resolve('electron/main/runners/mcpStdio.ts'),
        },
        output: { entryFileNames: '[name].js' },
      },
    },
    resolve: { alias: { '@main': resolve('electron/main'), '@shared': resolve('shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('electron/preload/index.ts') } },
    resolve: { alias: { '@shared': resolve('shared') } },
  },
  renderer: {
    root: '.',
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: resolve('index.html') } },
    resolve: { alias: { '@': resolve('src'), '@shared': resolve('shared') } },
  },
})
