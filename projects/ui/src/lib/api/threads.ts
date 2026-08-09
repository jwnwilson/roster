import { apiList, apiPatch, apiPost } from "./client";
import type { Message, MessageKind, Thread, ThreadListItem, ThreadStatus } from "./types";

export type ThreadFilters = {
  project_id?: string;
  work_item_id?: string;
  status?: ThreadStatus;
};

export type NewMessage = {
  author_kind: "user" | "agent";
  author_name?: string;
  kind?: MessageKind;
  content: string;
  /** Naming an agent starts its turn; omitting it just stores the message. */
  agent_name?: string;
};

export const listThreads = (filters: ThreadFilters = {}) =>
  apiList<ThreadListItem>("/threads", filters);

/** Moving to `resolved` writes the project's memory journal entry. Resolving an
 *  already-resolved thread returns 409 — that is the guarantee it happens once,
 *  not an error to swallow. */
export const patchThread = (id: string, patch: { status?: ThreadStatus; read?: boolean }) =>
  apiPatch<Thread>(`/threads/${id}`, patch);

export const listMessages = (threadId: string) =>
  apiList<Message>(`/threads/${threadId}/messages`);

export const postMessage = (threadId: string, message: NewMessage) =>
  apiPost<Message>(`/threads/${threadId}/messages`, message);

export const markAllThreadsRead = () => apiPost<{ marked: number }>("/threads/mark-all-read", {});

