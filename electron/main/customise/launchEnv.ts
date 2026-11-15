/**
 * The environment a customised copy is started with.
 *
 * ROSTER_HOME keeps its data apart from the official app. ROSTER_DEV_PORT lets
 * it run beside that app. ROSTER_CUSTOMISED switches its updater off, and only
 * a copy ever sets it.
 */
export function customisationLaunchEnv(copy: { rosterHome: string; devPort: number }): Record<string, string> {
  return {
    ROSTER_HOME: copy.rosterHome,
    ROSTER_DEV_PORT: String(copy.devPort),
    ROSTER_CUSTOMISED: '1',
  }
}
