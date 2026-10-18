export interface DesktopReport {
  accessibilityTrusted: boolean
  screenCaptureAllowed: boolean
  inputPostingAllowed: boolean
  visibleScreens: number
  frontmostApp: string | null
}

export interface DesktopTestResult {
  expected: string
  observed: string
  /** Only the disposable Roster test window, never the whole desktop. */
  screenshot: string
}
