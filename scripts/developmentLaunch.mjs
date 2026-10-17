export function developmentScript(platform, debug) {
  const mode = platform === 'darwin' ? 'app' : 'hot'
  return `dev:${mode}${debug ? ':debug' : ''}`
}
