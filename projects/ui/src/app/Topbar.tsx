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
  /** Disabled when no project is chosen — there is nothing to create against. */
  newDisabled?: boolean;
  /** Spec §6 keeps the handoff's artifact-store chip but makes it informational:
   *  the location is fixed at <project folder>/.roster/artifacts, so it shows
   *  the path and is never a picker. */
  artifactPath?: string;
}

export function Topbar({
  title, count, view, onViewChange, onNew, newDisabled = false, artifactPath,
}: TopbarProps) {
  return (
    <div className="flex h-[44px] shrink-0 items-center gap-2 border-b border-border-subtle px-[14px]">
      {/* Title */}
      <span className="text-13-5 font-semibold text-text-1">{title}</span>

      {/* Count */}
      <span className="font-mono text-10 text-text-6">{count}</span>

      {/* Vertical divider */}
      <div className="mx-1 h-[14px] w-px bg-border-strong" />

      {/* Filter chip */}
      <button className="inline-flex h-[26px] items-center gap-1 rounded-5 border border-border-strong px-[9px] text-11 text-text-3">
        All
        <ChevronDownIcon className="h-3 w-3" />
      </button>

      {artifactPath && (
        <span
          data-testid="artifact-chip"
          title={artifactPath}
          className="inline-flex h-[26px] items-center gap-1 rounded-5 border border-border-strong px-[9px] font-mono text-10-5 text-text-4"
        >
          artifacts · {artifactPath.split("/").slice(-3, -1).join("/")}
        </span>
      )}

      {/* Auto spacer */}
      <div className="ml-auto" />

      {/* View switcher */}
      <div className="flex overflow-hidden rounded-5 border border-border-strong">
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
      <Button variant="primary" onClick={onNew} disabled={newDisabled}>
        <PlusIcon className="h-3 w-3" />
        New
      </Button>
    </div>
  );
}
