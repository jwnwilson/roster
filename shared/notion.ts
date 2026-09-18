import type { TaskStatus } from './types'

/**
 * The shapes that cross the IPC boundary for the Notion integration.
 *
 * The logic that builds and reads these lives in the main process — this is
 * only the vocabulary the Notion modal needs.
 */

/**
 * What each Roster status is called on the user's Notion board.
 *
 * One map for the workspace. Several Roster statuses may share a Notion name,
 * because a default Notion board has three columns and Roster has five.
 */
export type NotionStatusMap = Record<TaskStatus, string>

/** The renderer may see the connection state, but never an OAuth credential. */
export type NotionAuthStatus =
  | { state: 'connected'; workspaceName: string | null }
  | { state: 'disconnected' }
  | { state: 'error'; message: string }
  | { state: 'needs_configuration'; message: string }
