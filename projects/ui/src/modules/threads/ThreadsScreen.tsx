import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { StatusBadge } from "../../components/ui/StatusBadge";
import { useThreadMessages, useThreads } from "../../lib/api/hooks";
import { queryKeys } from "../../lib/api/queryKeys";
import { patchThread } from "../../lib/api/threads";
import { useThreadStream } from "../../lib/hooks/useThreadStream";
import type { ThreadListItem, ThreadStatus } from "../../lib/api/types";
import { MessageList } from "./MessageList";

type Tab = "all" | "action_needed";

const BADGE_KIND: Record<ThreadStatus, "info" | "review_needed" | "action_needed" | "resolved"> = {
  info: "info",
  review_needed: "review_needed",
  action_needed: "action_needed",
  resolved: "resolved",
};

/** Threads — the global view. A thread is roster's unit of agent work, so this
 *  is where agent output is read; there is no run monitor (spec §6). */
export function ThreadsScreen() {
  const [tab, setTab] = useState<Tab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isPending, isError } = useThreads();
  const { data: messageData } = useThreadMessages(selectedId ?? undefined);

  const selectedThread = data?.results.find((thread) => thread.id === selectedId) ?? null;

  // Live messages as the agent writes them. A resolved thread is not subscribed
  // to: the backend closes that stream on purpose, and retrying it forever would
  // turn a normal end into a reconnect loop.
  useThreadStream(selectedId ?? undefined, {
    enabled: selectedThread !== null && selectedThread.status !== "resolved",
    onFrame: () => {
      if (selectedId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.threadMessages(selectedId) });
      }
    },
  });

  const mutate = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { status?: ThreadStatus; read?: boolean } }) =>
      patchThread(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.threads() }),
    // A repeat resolve is a 409 — the guarantee that memory is written exactly
    // once. Shown, not swallowed.
    onError: (cause: Error) => setError(cause.message),
  });

  if (isPending) return <p className="p-6 text-12 text-text-4">Loading threads…</p>;
  if (isError) {
    return (
      <p role="alert" className="p-6 text-12 text-badge-action-text">
        Could not load threads.
      </p>
    );
  }

  const threads = data.results.filter(
    (thread) => tab === "all" || thread.status === "action_needed",
  );
  const selected = selectedThread;

  const open = (thread: ThreadListItem) => {
    setSelectedId(thread.id);
    setError(null);
    if (!thread.read) mutate.mutate({ id: thread.id, patch: { read: true } });
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[356px] shrink-0 flex-col border-r border-border-subtle">
        <div className="flex h-[44px] items-center gap-3 px-[14px]" role="tablist">
          {(["all", "action_needed"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`text-11-5 ${tab === value ? "font-medium text-accent-text" : "text-text-4"}`}
            >
              {value === "all" ? "All" : "Action Needed"}
            </button>
          ))}
        </div>
        {data.results.length === 0 ? (
          <p className="p-6 text-12 text-text-3">No threads yet.</p>
        ) : (
          <ul>
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => open(thread)}
                  aria-label={thread.title}
                  className={`flex w-full flex-col items-start gap-1 border-b border-[rgba(255,255,255,0.03)] px-[14px] py-[13px] text-left ${
                    thread.status === "resolved" ? "opacity-40" : ""
                  } ${selectedId === thread.id ? "border-l-2 border-l-accent bg-[rgba(124,108,240,0.06)]" : ""}`}
                >
                  <StatusBadge kind={BADGE_KIND[thread.status]} />
                  <span className={`text-12-5 ${thread.read ? "text-[#c0c2c8]" : "font-medium text-text-1"}`}>
                    {thread.title}
                  </span>
                  {thread.last_message && (
                    <span className="truncate text-11 text-text-4">{thread.last_message}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {selected === null ? (
          <p className="p-6 text-12 text-text-3">Select a thread.</p>
        ) : (
          <>
            <div className="flex h-[44px] items-center gap-3 border-b border-border-subtle px-[14px]">
              <span className="text-12-5 font-medium text-text-1">{selected.title}</span>
              <button
                type="button"
                onClick={() => mutate.mutate({ id: selected.id, patch: { status: "resolved" } })}
                className="ml-auto rounded-5 border border-border-strong px-3 py-1 text-11 text-text-3"
              >
                Resolve
              </button>
            </div>
            {error && (
              <p role="alert" className="px-[14px] py-2 text-11-5 text-badge-action-text">
                {error}
              </p>
            )}
            <MessageList messages={messageData?.results ?? []} />
          </>
        )}
      </div>
    </div>
  );
}
