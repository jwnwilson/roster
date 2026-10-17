import { spawn as defaultSpawn } from 'node:child_process'
import { join, resolve } from 'node:path'

export function localAppPath(root, architecture) {
  return join(resolve(root), 'release', architecture === 'arm64' ? 'mac-arm64' : 'mac', 'Roster.app')
}

export function openArguments(appPath, environment, electronArguments) {
  const args = ['-n', '-W', '--stdout', '/dev/stdout', '--stderr', '/dev/stderr']
  for (const key of ['ROSTER_HOME', 'PATH']) {
    if (environment[key]) args.push('--env', `${key}=${environment[key]}`)
  }
  args.push(appPath)
  if (electronArguments.length > 0) args.push('--args', ...electronArguments)
  return args
}

export function openLocalApp(appPath, environment, electronArguments, spawn = defaultSpawn) {
  return new Promise((resolve, reject) => {
    const child = spawn('open', openArguments(appPath, environment, electronArguments), { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Launch Services exited with status ${code ?? 'unknown'}`))
    })
  })
}
