const LEVEL: Record<string, number> = { low: 1, medium: 2, high: 3, urgent: 3 };
const HEIGHTS = [4, 7, 10];

export function PriorityBars({ priority }: { priority: "low" | "medium" | "high" | "urgent" }) {
  const level = LEVEL[priority] ?? 0;
  return (
    <div className="flex items-end gap-[2px]">
      {HEIGHTS.map((h, i) => {
        const filled = i < level;
        return (
          <span key={i} data-bar data-filled={filled}
            style={{ width: 3, height: h, borderRadius: 1, background: filled ? "#4a4d56" : "#25272e" }} />
        );
      })}
    </div>
  );
}
