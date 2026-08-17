import path from "node:path";

export interface ResourcePaths {
  pythonBin: string;
  serverDir: string;
  alembicIni: string;
  uiDir: string;
  logFile: string;
}

export interface PathInput {
  isPackaged: boolean;
  resourcesPath: string;
  repoRoot: string;
  homeDir: string;
}

/**
 * Where the bundled halves live, packaged and unpackaged.
 *
 * Pure on purpose: everything Electron knows (isPackaged, resourcesPath) arrives
 * as an argument, so the mapping is testable without Electron.
 */
export function resolvePaths(input: PathInput): ResourcePaths {
  const logFile = path.join(input.homeDir, "Library", "Logs", "Roster", "server.log");

  if (input.isPackaged) {
    const resources = input.resourcesPath;
    return {
      pythonBin: path.join(resources, "python", "bin", "python"),
      serverDir: path.join(resources, "server"),
      alembicIni: path.join(resources, "server", "alembic.ini"),
      uiDir: path.join(resources, "ui"),
      logFile,
    };
  }

  return {
    pythonBin: path.join(input.repoRoot, "projects", "desktop", "build", "python", "bin", "python"),
    serverDir: path.join(input.repoRoot, "projects", "server"),
    alembicIni: path.join(input.repoRoot, "projects", "server", "alembic.ini"),
    uiDir: path.join(input.repoRoot, "projects", "ui", "dist"),
    logFile,
  };
}
