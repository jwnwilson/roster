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

/** Largest image, in decoded bytes, a chat message may show. */
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * An image a tool returned, as a data URL the chat can show, or null when it
 * may not be shown: an unsupported type, a missing or malformed payload, or
 * one over the size cap. Both runners use this, so a tool result is held to
 * the same rules as an image an agent writes into its text.
 */
export function embeddedImageUrl(mimeType: unknown, base64: unknown): string | null {
  if (typeof mimeType !== 'string' || typeof base64 !== 'string') return null
  const type = mimeType.toLowerCase()
  if (!EMBEDDABLE_DATA_TYPES.has(type)) return null
  if (base64 === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null
  const decodedBytes = Math.floor((base64.length * 3) / 4)
  if (decodedBytes > MAX_CHAT_IMAGE_BYTES) return null
  return `data:${type};base64,${base64}`
}
