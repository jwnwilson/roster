/**
 * How long a quoted passage may be.
 *
 * Selecting the whole plan and commenting on it should not paste the whole
 * plan into the note — the point of a quotation is to narrow.
 */
const MAX_QUOTE = 240

/**
 * What the reader has selected, ready to be quoted in a comment.
 *
 * Returns null when there is nothing usable: no selection, a bare click, or a
 * selection that strayed outside `container`. Selecting one of your own
 * earlier comments is not a note about the plan, so both ends have to be
 * inside it.
 */
export function quoteFromSelection(
  selection: Selection | null,
  container: Node | null,
): string | null {
  if (!selection || !container || selection.isCollapsed) return null
  if (!within(selection.anchorNode, container) || !within(selection.focusNode, container)) {
    return null
  }

  // Rendered Markdown carries the line breaks and indentation of its layout;
  // the words are the part worth quoting.
  const text = selection.toString().replace(/\s+/g, ' ').trim()
  if (text === '') return null

  return text.length <= MAX_QUOTE ? text : `${text.slice(0, MAX_QUOTE).trimEnd()}…`
}

function within(node: Node | null, container: Node): boolean {
  return node !== null && container.contains(node)
}
