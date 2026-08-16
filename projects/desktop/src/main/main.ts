import { createWriteStream, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { app, BrowserWindow, dialog } from "electron";

import { waitForHealth } from "./health";
import { STALE_BUNDLE_MESSAGE } from "./migrate";
import { resolvePaths } from "./paths";
import { findFreePort } from "./port";
import { readLoginShellPath, resolveShellPath } from "./shell-path";
import { runMigration, sidecarEnv, spawnSidecar } from "./spawn";
import { stopSidecar, type Sidecar } from "./supervisor";

let sidecar: Sidecar | null = null;
let window: BrowserWindow | null = null;

const paths = resolvePaths({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  repoRoot: path.resolve(__dirname, "..", "..", "..", ".."),
  homeDir: os.homedir(),
});

function openWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: "#0b0d12",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  created.loadFile(path.join(__dirname, "..", "..", "resources", "loading.html"));
  return created;
}

function fail(message: string): void {
  dialog.showErrorBox("Roster could not start", `${message}\n\nLog: ${paths.logFile}`);
  app.exit(1);
}

/** Spec §4.5: the log is capped, not rotated — a tester sends one file. */
const LOG_CAP_BYTES = 5_000_000;

function openLog(file: string): NodeJS.WritableStream {
  mkdirSync(path.dirname(file), { recursive: true });
  const existing = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
  // Append across launches so a crash and the restart after it are in one file,
  // but start fresh once it would grow without bound.
  return createWriteStream(file, { flags: existing > LOG_CAP_BYTES ? "w" : "a" });
}

/** Spec §4.5: a sidecar that dies after a healthy start offers Restart or Quit. */
function reportCrash(): void {
  const choice = dialog.showMessageBoxSync({
    type: "error",
    title: "Roster stopped",
    message: "The Roster server exited unexpectedly.",
    detail: `Log: ${paths.logFile}`,
    buttons: ["Restart", "Quit"],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice === 0) app.relaunch();
  app.exit(choice === 0 ? 0 : 1);
}

async function start(): Promise<void> {
  const logStream = openLog(paths.logFile);

  const resolved = await resolveShellPath({
    readShellPath: readLoginShellPath,
    inheritedPath: process.env.PATH ?? "",
  });
  logStream.write(`[roster] PATH from ${resolved.source}: ${resolved.path}\n`);

  const env = sidecarEnv({
    basePath: resolved.path,
    uiDir: paths.uiDir,
    inherited: process.env,
  });

  const migration = await runMigration({
    pythonBin: paths.pythonBin,
    args: ["-m", "alembic", "-c", paths.alembicIni, "upgrade", "head"],
    cwd: paths.serverDir,
    env,
    logStream,
  });
  if (!migration.ok) {
    fail(migration.reason === "stale-bundle" ? STALE_BUNDLE_MESSAGE : migration.message);
    return;
  }

  await new Promise<void>((resolve) => {
    const seed = spawnSidecar({
      pythonBin: paths.pythonBin,
      args: ["-m", "interactors.cli.seed"],
      cwd: paths.serverDir,
      env,
      logStream,
    });
    seed.exited.then(resolve);
  });

  const port = await findFreePort();
  const started = spawnSidecar({
    pythonBin: paths.pythonBin,
    args: [
      "-m",
      "uvicorn",
      // The desktop entry point, not create_app: --factory calls its target with
      // no arguments, and create_desktop_app is what turns roster_ui_dir into the
      // ui_dir argument. Pointing this at create_app serves 404s at /.
      "interactors.api.desktop:create_desktop_app",
      "--factory",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    cwd: paths.serverDir,
    env,
    logStream,
  });
  sidecar = started;

  started.exited.then(() => {
    // `before-quit` nulls this before stopping the sidecar, so a deliberate
    // shutdown never reaches the crash dialog.
    if (sidecar === null) return;
    reportCrash();
  });

  try {
    await waitForHealth({
      url: `http://127.0.0.1:${port}/api/health`,
      fetchImpl: fetch,
      sleep: (ms) => delay(ms),
      now: () => Date.now(),
    });
  } catch {
    fail("The server did not start in time.");
    return;
  }

  window?.loadURL(`http://127.0.0.1:${port}/`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(() => {
    window = openWindow();
    void start();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) window = openWindow();
  });

  app.on("window-all-closed", () => {
    // macOS convention: the app stays running until Cmd-Q.
  });

  app.on("before-quit", async (event) => {
    if (sidecar === null) return;
    event.preventDefault();
    const stopping = sidecar;
    sidecar = null;
    await stopSidecar(stopping, {
      kill: (pid, signal) => process.kill(pid, signal),
      sleep: (ms) => delay(ms),
    });
    app.quit();
  });
}
