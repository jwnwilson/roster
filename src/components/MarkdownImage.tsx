import { useEffect, useState } from 'react'
import { classifyImageSource } from '@shared/images'

interface MarkdownImageProps {
  src?: string
  alt?: string
}

/**
 * An image inside a message, shown at a size that fits the column.
 *
 * Embedded images show directly. A local path is read through the main
 * process first, since the renderer cannot load it. Remote images are not
 * fetched (the CSP forbids it), so they appear as a link the user can open.
 * Anything that will not show falls back to a line of text, never a broken
 * image icon.
 */
export function MarkdownImage({ src, alt }: MarkdownImageProps) {
  const source = classifyImageSource(src)
  const localPath = source.kind === 'local' ? source.path : null
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null)
  const [decodeFailed, setDecodeFailed] = useState(false)

  useEffect(() => {
    if (localPath === null) return
    let live = true
    window.roster.files
      .readImage(localPath)
      .then((url) => live && setLoaded({ path: localPath, url }))
      .catch(() => live && setLoaded({ path: localPath, url: null }))
    return () => {
      live = false
    }
  }, [localPath])

  const label = alt !== undefined && alt !== '' ? alt : (src ?? 'image')
  const placeholder = <span className="text-md text-faint-2">[image not available: {label}]</span>

  if (source.kind === 'remote') {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="text-accent-light">
        {label}
      </a>
    )
  }

  if (source.kind === 'unsupported') return placeholder

  const url = source.kind === 'data' ? src : loaded?.path === localPath ? loaded.url : undefined

  if (url === undefined) {
    return <span className="text-md text-faint-2">[loading image: {label}]</span>
  }
  if (url === null || decodeFailed) return placeholder

  return (
    <figure className="m-0 flex flex-col gap-[4px]">
      <img
        src={url}
        alt={label}
        onError={() => setDecodeFailed(true)}
        className="block max-h-[480px] max-w-full self-start rounded-chip border border-line"
      />
      {alt !== undefined && alt !== '' ? (
        <figcaption className="text-md text-faint-2">{alt}</figcaption>
      ) : null}
    </figure>
  )
}
