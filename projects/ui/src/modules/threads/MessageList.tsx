import { Avatar } from "../../components/ui/Avatar";
import type { Message } from "../../lib/api/types";

const KIND_LABEL: Record<Message["kind"], string | null> = {
  text: null,
  file_write: "WROTE",
  question: "ASKS",
  event: null,
};

/** One message. `kind` is what makes a thread more than chat — a file write and
 *  a question read differently from prose, and flattening them would lose the
 *  only record of what an agent actually did. */
export function MessageList({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    // An empty <ol> is indistinguishable from a list that failed to load.
    return <p className="p-[13px] text-11-5 text-text-4">Nothing has been said yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-3 p-[13px]">
      {messages.map((message) => {
        const fromAgent = message.author_kind === "agent";
        const label = KIND_LABEL[message.kind];
        return (
          <li
            key={message.id}
            data-testid={`message-${message.kind}`}
            className="flex items-start gap-2"
          >
            <Avatar
              initials={(message.author_name ?? "you").slice(0, 2).toUpperCase()}
              variant={fromAgent ? "agent" : "user"}
              size={22}
              title={message.author_name ?? "you"}
            />
            <div
              className={
                fromAgent
                  ? "rounded-[4px_12px_12px_12px] border border-border bg-bg-surface px-3 py-2"
                  : "rounded-[12px_4px_12px_12px] border border-accent-border bg-accent-bg px-3 py-2"
              }
            >
              {label && (
                <span className="mr-2 font-mono text-9-5 tracking-[0.03em] text-accent-text">
                  {label}
                </span>
              )}
              <span
                className={`text-12-5 leading-[1.65] ${
                  message.kind === "file_write"
                    ? "font-mono text-text-3"
                    : fromAgent
                      ? "text-text-message"
                      : "text-accent-text"
                }`}
              >
                {message.content}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
