import { useRef, useState } from 'react'
import { MarkdownImage } from './MarkdownImage'

export interface CarouselImage {
  src?: string
  alt?: string
}

/** How many images show side by side in the viewport at once. */
const PER_VIEW = 2

/** Gap between slides, in px. Matches the `gap-[12px]` on the track. */
const GAP = 12

interface ImageCarouselProps {
  images: CarouselImage[]
}

/**
 * Several images in one message, side by side, slid through two at a time.
 *
 * The track is a native horizontal scroll with snap points, so swiping a
 * trackpad and the arrow buttons agree. Each image keeps its own frame and
 * its own magnified view.
 */
export function ImageCarousel({ images }: ImageCarouselProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const count = images.length
  const lastIndex = Math.max(0, count - PER_VIEW)

  /** The distance from one slide to the next, read from the layout. */
  const stepOf = (viewport: HTMLElement): number => {
    const slides = viewport.querySelectorAll<HTMLElement>('[data-slide]')
    if (slides.length < 2) return 0
    return slides[1]!.offsetLeft - slides[0]!.offsetLeft
  }

  const goTo = (next: number) => {
    const target = Math.min(Math.max(next, 0), lastIndex)
    setIndex(target)
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTo({ left: target * stepOf(viewport), behavior: 'smooth' })
  }

  // A swipe moves the track without a button press, so the count follows the
  // scroll position as well.
  const onScroll = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    const step = stepOf(viewport)
    if (step === 0) return
    setIndex(Math.min(Math.round(viewport.scrollLeft / step), lastIndex))
  }

  const first = index + 1
  const last = Math.min(index + PER_VIEW, count)

  return (
    <div role="region" aria-roledescription="carousel" aria-label="Images" className="flex flex-col gap-[6px]">
      <div className="flex items-center gap-[8px]">
        <button
          type="button"
          aria-label="Previous images"
          disabled={index === 0}
          onClick={() => goTo(index - 1)}
          className="flex-none cursor-pointer rounded-chip border border-line-input bg-transparent px-[9px] py-[4px] font-ui text-lg text-accent-text hover:border-accent-line disabled:cursor-default disabled:opacity-40"
          data-hoverable
        >
          ‹
        </button>
        <div
          ref={viewportRef}
          onScroll={onScroll}
          className="flex min-w-0 flex-1 snap-x snap-mandatory gap-[12px] overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.map((image, i) => (
            <div
              key={`${i}:${image.src ?? ''}`}
              data-slide
              role="group"
              aria-roledescription="slide"
              aria-label={`Slide ${i + 1} of ${count}`}
              className="w-[calc(50%-6px)] flex-none snap-start"
            >
              <MarkdownImage src={image.src} alt={image.alt} />
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-label="Next images"
          disabled={index >= lastIndex}
          onClick={() => goTo(index + 1)}
          className="flex-none cursor-pointer rounded-chip border border-line-input bg-transparent px-[9px] py-[4px] font-ui text-lg text-accent-text hover:border-accent-line disabled:cursor-default disabled:opacity-40"
          data-hoverable
        >
          ›
        </button>
      </div>
      <div className="text-center text-md text-faint-2">
        {first === last ? `${first}` : `${first}–${last}`} of {count}
      </div>
    </div>
  )
}
