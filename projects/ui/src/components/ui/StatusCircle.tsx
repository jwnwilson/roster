export type WorkItemStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";

export function StatusCircle({ status, size = 13 }: { status: WorkItemStatus; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      {status === "backlog" && (
        <circle cx="6.5" cy="6.5" r="4.5" stroke="#25272e" strokeWidth="1.5" strokeDasharray="2.5 2" fill="none" />
      )}
      {status === "todo" && (
        <circle cx="6.5" cy="6.5" r="4.5" stroke="#3a3d46" strokeWidth="1.5" fill="none" />
      )}
      {status === "in_progress" && (
        <>
          <circle cx="6.5" cy="6.5" r="4.5" stroke="#22252c" strokeWidth="1.5" fill="none" />
          <circle cx="6.5" cy="6.5" r="4.5" stroke="#7c6cf0" strokeWidth="1.5"
            strokeDasharray="14.14 14.14" transform="rotate(-90 6.5 6.5)" fill="none" />
        </>
      )}
      {status === "in_review" && (
        <>
          <circle cx="6.5" cy="6.5" r="4.5" stroke="#22252c" strokeWidth="1.5" fill="none" />
          <circle cx="6.5" cy="6.5" r="4.5" stroke="#52555e" strokeWidth="1.5"
            strokeDasharray="21.2 7.07" transform="rotate(-90 6.5 6.5)" fill="none" />
        </>
      )}
      {status === "done" && (
        <>
          <circle cx="6.5" cy="6.5" r="4.5" fill="#1e2028" />
          <path d="M4.5 6.5l1.5 1.5 2.5-2.5" stroke="#0b0c0f" strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}
