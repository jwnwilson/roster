import { execFile } from "node:child_process";

export const SHELL_PATH_TIMEOUT_MS = 2000;

export interface ResolvedPath {
  path: string;
  source: "login-shell" | "inherited";
}

/**
 * Ask the user's login shell what PATH it would give an interactive session.
 *
 * `-ilc` so rc files that add ~/.local/bin, nvm shims and homebrew are read.
 * The timeout matters: an rc file that blocks on a prompt would otherwise hang
 * the app before its window ever appears.
 */
export function readLoginShellPath(timeoutMs = SHELL_PATH_TIMEOUT_MS): Promise<string> {
  const shell = process.env.SHELL ?? "/bin/zsh";
  return new Promise((resolve, reject) => {
    execFile(
      shell,
      ["-ilc", 'printf "%s" "$PATH"'],
      { timeout: timeoutMs, encoding: "utf8" },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

export async function resolveShellPath(deps: {
  readShellPath: () => Promise<string>;
  inheritedPath: string;
}): Promise<ResolvedPath> {
  try {
    const path = (await deps.readShellPath()).trim();
    if (path.length > 0) return { path, source: "login-shell" };
  } catch {
    // Falls through to the inherited PATH below.
  }
  return { path: deps.inheritedPath, source: "inherited" };
}
