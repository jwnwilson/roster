/**
 * The Notion page operations Roster needs, and nothing else.
 *
 * Kept as an interface so the import and push logic is tested offline, and
 * so the hosted-MCP argument shapes live in one adapter that can follow the
 * server when it changes.
 */
export interface NotionPageInfo {
  pageId: string
  title: string
  /** The page's current status option name, if it has a status property. */
  status: string | null
}

export interface NotionPages {
  /** Reads a page by URL or id. Throws if it is not a page Roster can see. */
  fetchPage(urlOrId: string): Promise<NotionPageInfo>
  setStatus(pageId: string, notionStatus: string): Promise<void>
  addComment(pageId: string, text: string): Promise<void>
}
