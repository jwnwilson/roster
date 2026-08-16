import Markdown from "react-markdown";

/** The item's spec, marked `agent-editable` in the design — agents write here as
 *  part of their work, which is why it is markdown on the item rather than a
 *  comment thread. */
export function SpecTab({ spec }: { spec: string | null }) {
  if (!spec) {
    return <p className="p-6 text-12 text-text-3">No spec written yet.</p>;
  }

  return (
    <div className="max-w-[70ch] px-6 py-5 text-13 leading-[1.72] text-text-3 [&_h1]:text-[15.5px] [&_h1]:font-semibold [&_h1]:text-text-bright [&_h2]:text-13-5 [&_h2]:font-semibold [&_h2]:text-text-bright [&_code]:font-mono [&_code]:text-11 [&_pre]:rounded-6 [&_pre]:border [&_pre]:border-overlay-06 [&_pre]:bg-bg-inset [&_pre]:p-3">
      <Markdown>{spec}</Markdown>
    </div>
  );
}
