import type { ChildProcess, SpawnOptions } from 'node:child_process'

export function localAppPath(root: string, architecture: string): string
export function openArguments(
  appPath: string,
  environment: NodeJS.ProcessEnv,
  electronArguments: string[],
): string[]
export function openLocalApp(
  appPath: string,
  environment: NodeJS.ProcessEnv,
  electronArguments: string[],
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess,
): Promise<void>
