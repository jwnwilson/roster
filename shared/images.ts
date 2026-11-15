/**
 * Which images a chat message may show, and how each one is reached.
 *
 * Shared so the renderer decides and the main process enforces the same
 * rules: the renderer asks for a local file only when this says so, and the
 * main process refuses anything this would not have allowed.
 */

/** Extension (lower case, no dot) to the MIME type it is served as. */
export const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** Embedded data URLs allowed in chat. SVG is left out: it can carry script. */
const EMBEDDABLE_DATA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export type ImageSource =
  | { kind: 'data' }
  | { kind: 'local'; path: string }
  | { kind: 'remote' }
  | { kind: 'unsupported' }

export function classifyImageSource(src: string | undefined): ImageSource {
  if (src === undefined || src === '') return { kind: 'unsupported' }

  if (src.startsWith('data:')) {
    const type = /^data:([^;,]+)[;,]/.exec(src)?.[1]?.toLowerCase()
    return type !== undefined && EMBEDDABLE_DATA_TYPES.has(type)
      ? { kind: 'data' }
      : { kind: 'unsupported' }
  }

  if (/^https?:\/\//i.test(src)) return { kind: 'remote' }

  if (src.startsWith('/') && IMAGE_MIME_BY_EXTENSION[extensionOf(src)] !== undefined) {
    return { kind: 'local', path: src }
  }

  return { kind: 'unsupported' }
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
}
