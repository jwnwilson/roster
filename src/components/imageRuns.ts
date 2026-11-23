/**
 * The part of a hast tree this file reads. Declared here rather than imported,
 * because the renderer only needs these few fields.
 */
interface HastNode {
  type: string
  tagName?: string
  value?: string
  children?: HastNode[]
  properties?: Record<string, unknown>
}

/**
 * Joins consecutive image-only paragraphs into one paragraph.
 *
 * An agent writes `![a](…)` and `![b](…)` on separate lines with a blank line
 * between, and Markdown makes each its own paragraph. Left alone, the two
 * would stack. Joined, the paragraph renders as one carousel. Text between
 * images breaks the run, so prose is never swallowed into a carousel.
 */
export function rehypeJoinImageRuns() {
  return (tree: HastNode) => {
    joinIn(tree)
  }
}

function joinIn(parent: HastNode): void {
  const children = parent.children
  if (children === undefined) return

  for (const child of children) joinIn(child)

  const out: HastNode[] = []
  let run: HastNode | null = null
  for (const child of children) {
    if (isImageParagraph(child)) {
      if (run === null) {
        run = child
        out.push(child)
      } else {
        run.children!.push(...child.children!)
      }
      continue
    }
    // Whitespace between two images in a run is not a break.
    if (run !== null && isBlank(child)) continue
    run = null
    out.push(child)
  }
  parent.children = out
}

function isBlank(node: HastNode): boolean {
  return node.type === 'text' && (node.value ?? '').trim() === ''
}

function isImage(node: HastNode): boolean {
  return node.type === 'element' && node.tagName === 'img'
}

/** Children of a paragraph that are not whitespace. */
function contentOf(node: HastNode): HastNode[] {
  return (node.children ?? []).filter((child) => !isBlank(child))
}

function isImageParagraph(node: HastNode): boolean {
  if (node.type !== 'element' || node.tagName !== 'p') return false
  const content = contentOf(node)
  return content.length > 0 && content.every(isImage)
}

/** The images in a paragraph that holds nothing else, or null for any other paragraph. */
export function imagesOnly(
  node: HastNode | undefined,
): Array<{ src?: string; alt?: string }> | null {
  if (node === undefined) return null
  const content = contentOf(node)
  if (content.length === 0 || !content.every(isImage)) return null
  return content.map((child) => {
    const props = child.properties ?? {}
    return {
      src: typeof props['src'] === 'string' ? props['src'] : undefined,
      alt: typeof props['alt'] === 'string' ? props['alt'] : undefined,
    }
  })
}
