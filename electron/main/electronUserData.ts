/** The narrow Electron surface needed before app readiness. */
export interface ElectronPathConfig {
  setPath(name: string, path: string): void
}

/**
 * Make an explicit Roster home the complete Electron profile boundary.
 *
 * Electron keeps its single-instance lock below `userData`, so this must run
 * before `requestSingleInstanceLock()`. Without it, two development runs with
 * separate databases still contend for one process-wide Electron profile.
 */
export function configureElectronUserData(
  app: ElectronPathConfig,
  rosterHome = process.env['ROSTER_HOME'],
): void {
  if (rosterHome === undefined) return

  app.setPath('userData', rosterHome)
}
