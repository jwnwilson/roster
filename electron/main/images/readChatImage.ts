import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, extname } from 'node:path'
import { IMAGE_MIME_BY_EXTENSION, MAX_CHAT_IMAGE_BYTES } from '../../../shared/images'

/** Largest local image a chat message may show. Larger files are refused. */
export { MAX_CHAT_IMAGE_BYTES }

/**
 * Reads an image an agent pointed at, as a data URL the renderer can show.
 *
 * Only absolute paths to image files under the size cap are read. Anything
 * else resolves null, and so does a file that has gone missing, because a
 * message can outlive the file it names and that is not an error to report.
 */
export async function readChatImage(path: string): Promise<string | null> {
  if (!isAbsolute(path)) return null

  const mime = IMAGE_MIME_BY_EXTENSION[extname(path).slice(1).toLowerCase()]
  if (mime === undefined) return null

  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_CHAT_IMAGE_BYTES) return null

    const bytes = await readFile(path)
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}
