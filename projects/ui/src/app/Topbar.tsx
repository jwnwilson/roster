import { Button } from "../components/ui/Button";
import { Chip } from "../components/ui/Chip";
import { GridIcon } from "../components/ui/icons/GridIcon";
import { ListIcon } from "../components/ui/icons/ListIcon";
import { PlusIcon } from "../components/ui/icons/PlusIcon";
import { ChevronDownIcon } from "../components/ui/icons/ChevronDownIcon";

type View = "board" | "list";

export interface TopbarProps {
  title: string;
  count: number;
  view: View;
  onViewChange: (next: View) => void;
  onNew: () => void;
}

export function Topbar({ title, count, view, onViewChange, onNew }: TopbarProps) {
  return (
    <div className="flex h-[44px] shrink-0 items-center gap-2 border-b border-[rgba(255,255,255,0.055)] px-[14px]">
      {/* Title */}
      <span className="text-[13.5px] font-semibold text-text-1">{title}</span>

      {/* Count */}
      <span className="font-mono text-[10px] text-[#30333c]">{count}</span>

      {/* Vertical divider */}
      <div className="mx-1 h-[14px] w-px bg-[rgba(255,255,255,0.08)]" />

      {/* Filter chip */}
      <button className="inline-flex h-[26px] items-center gap-1 rounded-[5px] border border-border-strong px-[9px] text-[11px] text-[#66696f]">
        All
        <ChevronDownIcon className="h-3 w-3" />
      </button>

      {/* Auto spacer */}
      <div className="ml-auto" />

      {/* View switcher */}
      <div className="flex overflow-hidden rounded-[5px] border border-border-strong">
        <Chip active={view === "list"} onClick={() => onViewChange("list")}>
          <ListIcon className="h-3 w-3" />
          List
        </Chip>
        <Chip active={view === "board"} onClick={() => onViewChange("board")}>
          <GridIcon className="h-3 w-3" />
          Board
        </Chip>
      </div>

      {/* New button */}
      <Button variant="primary" onClick={onNew}>
        <PlusIcon className="h-3 w-3" />
        New
      </Button>
    </div>
  );
}
