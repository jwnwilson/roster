import { isPermissionKind, type PermissionKind, type PermissionReport, type PermissionStatus } from '../../../shared/permissions'
import type { DesktopReport } from '../../../shared/desktop'

/**
 * Where each permission lives in System Settings. The Privacy panes are
 * addressed by these keys, so a link to the generic Security page would make
 * the user hunt for the right one.
 */
export const SETTINGS_URLS: Record<PermissionKind, string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
}

const KNOWN: readonly PermissionStatus[] = ['granted', 'denied', 'not-determined', 'restricted', 'unknown']

/**
 * Electron's answer, narrowed. Anything it does not recognise is unknown
 * rather than granted: a permission we cannot read is not one we can claim.
 */
export function mediaStatus(value: unknown): PermissionStatus {
  return KNOWN.includes(value as PermissionStatus) ? (value as PermissionStatus) : 'unknown'
}

/** The platform calls this service makes, so it can be tested without Electron. */
export interface SystemPermissionsDeps {
  platform: NodeJS.Platform
  mediaStatus(kind: 'screen' | 'microphone'): unknown
  askForMicrophone(): Promise<boolean>
  /** Asking for a screen source is what makes macOS show the Screen Recording prompt. */
  promptForScreen(): Promise<void>
  helper: {
    check(): Promise<Pick<DesktopReport, 'accessibilityTrusted'>>
    requestAccessibility(): Promise<void>
  }
  openExternal(url: string): Promise<void>
}

/**
 * Reads and requests the macOS permissions. A permission is always granted or
 * refused by the user in System Settings; this service only reports what it
 * can see, asks where macOS lets it ask, and opens the right pane.
 */
export class SystemPermissions {
  constructor(private readonly deps: SystemPermissionsDeps) {}

  async status(): Promise<PermissionReport> {
    if (this.deps.platform !== 'darwin') {
      return { screen: 'not-applicable', accessibility: 'not-applicable', microphone: 'not-applicable' }
    }
    return {
      screen: mediaStatus(this.deps.mediaStatus('screen')),
      accessibility: await this.accessibility(),
      microphone: mediaStatus(this.deps.mediaStatus('microphone')),
    }
  }

  /**
   * Accessibility belongs to the desktop helper, not to Roster, so it is read
   * from there. A helper that cannot run says unknown, not denied: those are
   * different problems and the card words them differently.
   */
  private async accessibility(): Promise<PermissionStatus> {
    try {
      const report = await this.deps.helper.check()
      return report.accessibilityTrusted ? 'granted' : 'denied'
    } catch {
      return 'unknown'
    }
  }

  async request(kind: PermissionKind): Promise<PermissionReport> {
    if (!isPermissionKind(kind)) throw new Error(`Unknown permission "${String(kind)}".`)
    if (this.deps.platform !== 'darwin') throw new Error('Permissions are macOS only.')

    if (kind === 'microphone') await this.deps.askForMicrophone()
    else if (kind === 'screen') await this.deps.promptForScreen()
    else await this.deps.helper.requestAccessibility()

    return this.status()
  }

  async openSettings(kind: PermissionKind): Promise<void> {
    if (!isPermissionKind(kind)) throw new Error(`Unknown permission "${String(kind)}".`)
    await this.deps.openExternal(SETTINGS_URLS[kind])
  }
}
