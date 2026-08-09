import { useQueryClient } from "@tanstack/react-query";

import { useThreadMessages, useThreads } from "../../lib/api/hooks";
import { queryKeys } from "../../lib/api/queryKeys";
import { useThreadStream } from "../../lib/hooks/useThreadStream";
import { MessageList } from "../threads/MessageList";
import { ThreadComposer } from "../threads/ThreadComposer";

/** The work item's conversation — handoff §D3.
 *
 * The same thread the Threads screen shows, filtered to this item. There is no
 * separate agent-monitor tab: this is where agent output is read (spec §6). */
export function ThreadTab({ workItemId }: { workItemId: string }) {
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useThreads({ work_item_id: workItemId });
  const thread = data?.results[0];
  const { data: messageData } = useThreadMessages(thread?.id);

  useThreadStream(thread?.id, {
    enabled: thread !== undefined && thread.status !== "resolved",
    onFrame: () => {
      if (thread) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.threadMessages(thread.id) });
      }
    },
  });

  if (isPending) return <p className="p-6 text-12 text-text-4">Loading the conversation…</p>;
  if (isError) {
    return (
      <p role="alert" className="p-6 text-12 text-badge-action-text">
        Could not load this item&rsquo;s conversation.
      </p>
    );
  }
  if (!thread) {
    return <p className="p-6 text-12 text-text-3">No conversation on this work item yet.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <MessageList messages={messageData?.results ?? []} />
      </div>
      <ThreadComposer
        threadId={thread.id}
        agentName={thread.participants[0] ?? null}
        disabled={thread.status === "resolved"}
      />
    </div>
  );
}
