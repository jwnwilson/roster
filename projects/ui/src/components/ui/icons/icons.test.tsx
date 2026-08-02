import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as Icons from "./index";

describe("icon set", () => {
  const names = [
    "DashboardIcon", "InboxIcon", "ProjectsIcon", "AgentsIcon", "SettingsIcon",
    "SearchIcon", "GitRepoIcon", "ListIcon", "GridIcon", "PlusIcon",
    "ChevronDownIcon", "ChevronRightIcon", "CheckIcon", "DocumentIcon", "PencilIcon",
  ] as const;

  it("exports every named icon", () => {
    for (const name of names) expect(Icons[name as keyof typeof Icons]).toBeTypeOf("function");
  });

  it("renders an svg that inherits colour via currentColor and respects size", () => {
    const { container } = render(<Icons.PlusIcon size={20} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute("width")).toBe("20");
    expect(container.innerHTML).toContain("currentColor");
  });

  it("applies className to the svg", () => {
    const { container } = render(<Icons.CheckIcon className="text-accent" />);
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("text-accent");
  });
});
