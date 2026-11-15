import { desktopCapturer, shell, systemPreferences } from 'electron'
import { SystemPermissions, type SystemPermissionsDeps } from './system'

/**
 * The real platform behind the permissions service. Kept apart from system.ts
 * so that module, and its tests, never load Electron.
 */
export function systemPermissionsFor(
  helper: SystemPermissionsDeps['helper'],
  platform: NodeJS.Platform = process.platform,
): SystemPermissions {
  return new SystemPermissions({
    platform,
    mediaStatus: (kind) => systemPreferences.getMediaAccessStatus(kind),
    askForMicrophone: () => systemPreferences.askForMediaAccess('microphone'),
    promptForScreen: async () => {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
    },
    helper,
    openExternal: (url) => shell.openExternal(url),
  })
}
