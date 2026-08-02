// A project-level "chat with lead" thread is addressed by a namespaced id,
// mirroring the backend (domain/messaging/thread.py).
export const PROJECT_THREAD_PREFIX = "project:";

export const projectThreadId = (projectId: string): string =>
  `${PROJECT_THREAD_PREFIX}${projectId}`;

export const isProjectThread = (threadId: string): boolean =>
  threadId.startsWith(PROJECT_THREAD_PREFIX);

export const projectIdFromThread = (threadId: string): string =>
  threadId.slice(PROJECT_THREAD_PREFIX.length);
