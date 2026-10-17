import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.env.electron_config_cache === undefined) {
  const cache = join(tmpdir(), 'roster-electron-cache')
  await mkdir(cache, { recursive: true })
  process.env.electron_config_cache = cache
}

const require = createRequire(import.meta.url)
const electron = require('electron')

process.stdout.write(`Electron binary ready: ${electron}\n`)
