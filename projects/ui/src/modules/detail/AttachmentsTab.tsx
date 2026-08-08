import { useState } from "react";

import { DataSourceBadge } from "../../components/DataSourceBadge";
import { attachments, formatBytes } from "../../mocks/unbacked/attachments.list";

type Filter = "all" | "uploaded" | "agent_output";

const LABEL: Record<Filter, string> = {
  all: "All",
  uploaded: "Uploaded",
  agent_output: "Agent output",
};

/** Attachments — fixtures. There is no `Attachment` persistence, so upload is
 *  present to settle its shape and says plainly that it does not keep anything. */
export function AttachmentsTab() {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = attachments.filter((file) => filter === "all" || file.origin === filter);
  const total = attachments.reduce((sum, file) => sum + file.bytes, 0);

  return (
    <div className="px-6 py-5">
      <div className="flex items-center gap-2 pb-3">
        <span className="font-mono text-9-5 tracking-[0.07em] text-text-7">ATTACHMENTS</span>
        <span className="font-mono text-10 text-text-5">
          {attachments.length} files · {formatBytes(total)}
        </span>
        <DataSourceBadge screen="workItemAttachments" />
      </div>

      <div className="rounded-8 border border-dashed border-accent-border bg-[rgba(124,108,240,0.045)] p-5 text-center">
        <p className="text-12 text-text-2">Drop files here, or browse</p>
        <p className="mt-1 text-11 text-text-5">
          Agents can read every attachment · 25 MB per file
        </p>
        <p className="mt-2 text-11 text-badge-review-text">
          Uploads are not kept — attachments have no backend yet.
        </p>
      </div>

      <div className="flex items-center gap-2 py-3">
        {(["all", "uploaded", "agent_output"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-5 border px-[9px] py-1 text-11 ${
              filter === value
                ? "border-accent-border bg-accent-bg text-accent-text"
                : "border-border-strong text-text-3"
            }`}
          >
            {LABEL[value]}
          </button>
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {shown.map((file) => (
          <li
            key={file.id}
            className="flex items-center gap-3 rounded-8 bg-[#101214] px-3 py-2"
          >
            <span className="text-12-5 text-[#d0d2d8]">{file.filename}</span>
            <span className="font-mono text-10-5 text-text-5">
              {formatBytes(file.bytes)} · {file.author}
            </span>
            <span
              className={`ml-auto rounded-4 border px-2 py-[2px] font-mono text-9-5 ${
                file.origin === "agent_output"
                  ? "border-accent-border bg-accent-bg text-accent-text"
                  : "border-border-strong text-text-4"
              }`}
            >
              {file.origin === "agent_output" ? "Agent output" : "Uploaded"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
