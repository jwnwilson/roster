export interface DesktopReport {
  accessibilityTrusted: boolean
  screenCaptureAllowed: boolean
  inputPostingAllowed: boolean
  visibleScreens: number
  frontmostApp: string | null
}
export type DesktopPermission = 'accessibility' | 'screen'
