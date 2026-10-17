import { existsSync } from 'node:fs'
import { arch, argv, cwd, env, platform } from 'node:process'
import { localAppPath, openLocalApp } from './localAppLaunch.mjs'

if (platform !== 'darwin') throw new Error('dev:app is only available on macOS')

const appPath = localAppPath(cwd(), arch)
if (!existsSync(appPath)) throw new Error(`Local app bundle was not produced at ${appPath}`)

await openLocalApp(appPath, env, argv.slice(2))
