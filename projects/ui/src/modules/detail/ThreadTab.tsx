import { useQueryClient } from "@tanstack/react-query";

import { useThreadMessages, useThreads } from "../../lib/api/hooks";
import { queryKeys } from "../../lib/api/queryKeys";
import { useThreadStream } from "../../lib/hooks/useThreadStream";
import { MessageList } from "../threads/MessageList";

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

  return <MessageList messages={messageData?.results ?? []} />;
}
