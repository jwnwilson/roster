import { spawn } from "node:child_process";

import { classifyMigration, type MigrationOutcome } from "./migrate";
import type { Sidecar } from "./supervisor";

export interface EnvInput {
  basePath: string;
  uiDir: string;
  inherited: NodeJS.ProcessEnv;
}

/**
 * The environment the sidecar runs in.
 *
 * `roster_data_root` is deliberately deleted rather than set: the default is
 * `~/.roster`, and an inherited value from whatever launched the app would
 * silently fork the operator's data.
 */
export function sidecarEnv(input: EnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...input.inherited };
  delete env.roster_data_root;
  return {
    ...env,
    PATH: input.basePath,
    roster_use_subprocess_runtime: "true",
    roster_ui_dir: input.uiDir,
  };
}

export interface SpawnOptions {
  pythonBin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logStream: NodeJS.WritableStream;
}

export function spawnSidecar(options: SpawnOptions): Sidecar {
  const child = spawn(options.pythonBin, options.args, {
    cwd: options.cwd,
    env: options.env,
    // Its own process group, so stopSidecar can signal the whole tree.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(options.logStream, { end: false });
  child.stderr.pipe(options.logStream, { end: false });

  return {
    pid: child.pid ?? -1,
    exited: new Promise<void>((resolve) => child.once("exit", () => resolve())),
  };
}

export function runMigration(options: SpawnOptions): Promise<MigrationOutcome> {
  return new Promise((resolve) => {
    const child = spawn(options.pythonBin, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      options.logStream.write(chunk);
    });
    child.stdout.pipe(options.logStream, { end: false });
    child.once("exit", (code) => resolve(classifyMigration(code, stderr)));
  });
}
