import type { ReactNode } from "react";
import { Card } from "./Card";

export function MetricCard(
  { label, value, sub, accent = false }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean },
) {
  return (
    <Card className={`p-[15px] ${accent ? "border-accent-border" : ""}`}>
      <div className="font-mono text-[9.5px] tracking-[0.07em] text-text-6">{label}</div>
      <div className="mt-2 text-[30px] font-semibold text-text-1 leading-none">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-text-5">{sub}</div>}
    </Card>
  );
}
