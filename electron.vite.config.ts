import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('electron/main/index.ts') } },
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
