import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "../../components/ui/Button";
import { queryKeys } from "../../lib/api/queryKeys";
import { postMessage } from "../../lib/api/threads";

export interface ThreadComposerProps {
  threadId: string;
  /** Naming an agent starts its turn; leaving it unset just records the message. */
  agentName?: string | null;
  disabled?: boolean;
}

/** Reply to a thread.
 *
 * Without this an agent can ask a question, the backend moves the thread to
 * action_needed, the badge appears — and there is no way to answer. That is the
 * app's core loop, so the composer is not optional furniture.
 */
export function ThreadComposer({ threadId, agentName, disabled = false }: ThreadComposerProps) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const send = useMutation({
    mutationFn: () =>
      postMessage(threadId, {
        author_kind: "user",
        content,
        ...(agentName ? { agent_name: agentName } : {}),
      }),
    onSuccess: async () => {
      setContent("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.threadMessages(threadId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.threads() });
    },
    onError: (cause: Error) => setError(cause.message),
  });

  if (disabled) {
    return (
      <p className="border-t border-border-subtle p-[13px] text-11-5 text-text-4">
        This thread is resolved. Reopen it to reply.
      </p>
    );
  }

  const submit = () => {
    if (send.isPending || content.trim() === "") return;
    setError(null);
    send.mutate();
  };

  return (
    <form
      className="border-t border-border-subtle p-[13px]"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="sr-only">Reply</span>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={agentName ? `Reply to @${agentName}…` : "Reply…"}
          rows={2}
          className="rounded-7 border border-border-strong bg-bg-input p-2 text-12 text-text-1"
        />
      </label>
      <div className="mt-2 flex items-center gap-2">
        {agentName && (
          <span className="rounded-[3px] border border-border px-2 py-[2px] font-mono text-9-5 text-text-4">
            @{agentName}
          </span>
        )}
        <Button type="submit" variant="primary" disabled={send.isPending || content.trim() === ""}>
          Send ↑
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-11-5 text-badge-action-text">
          {error}
        </p>
      )}
    </form>
  );
}
