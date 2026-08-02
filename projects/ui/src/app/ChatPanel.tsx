import { useThreads } from "../lib/api/hooks";
import { useLocalStorage } from "../lib/hooks/useLocalStorage";

export interface ChatPanelProps {
  projectId?: string;
}

/** The lead-agent conversation, on every project screen.
 *
 * Its threads are the project's threads with no `work_item_id` — the same table
 * and the same components the Threads screen uses (spec §4). Task 9 gives it a
 * message list and composer; this is the panel and its collapse behaviour.
 */
export function ChatPanel({ projectId }: ChatPanelProps) {
  const [open, setOpen] = useLocalStorage("roster.chat.open", true);
  const { data } = useThreads(projectId ? { project_id: projectId } : {});
  const leadThreads = (data?.results ?? []).filter((thread) => thread.work_item_id === null);

  if (!open) {
    return (
      <aside className="flex w-[34px] shrink-0 flex-col items-center border-l border-border-subtle bg-bg-sidebar py-2">
        <button
          type="button"
          aria-label="Expand chat"
          onClick={() => setOpen(true)}
          className="flex size-[14px] items-center justify-center rounded-[3px] border border-[rgba(255,255,255,0.10)] text-text-7"
        >
          ▸
        </button>
        <span className="mt-2 font-mono text-[8.5px] tracking-[0.09em] text-text-7 [writing-mode:vertical-rl]">
          CHAT ⌘J
        </span>
      </aside>
    );
  }

  return (
    <aside className="flex w-[292px] shrink-0 flex-col border-l border-border-subtle bg-[#09090c]">
      <div className="flex h-[44px] items-center border-b border-border-subtle px-[13px]">
        <span className="text-11-5 font-medium text-accent-text">Chat</span>
        <button
          type="button"
          aria-label="Collapse chat"
          onClick={() => setOpen(false)}
          className="ml-auto text-text-4"
        >
          ◂
        </button>
      </div>
      <ul className="flex flex-col gap-1 p-[13px]">
        {leadThreads.map((thread) => (
          <li key={thread.id} className="text-11-5 text-text-2">
            {thread.title}
          </li>
        ))}
      </ul>
    </aside>
  );
}
