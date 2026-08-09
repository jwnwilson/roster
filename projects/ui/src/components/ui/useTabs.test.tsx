import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { useTabs } from "./useTabs";

const TABS = ["One", "Two", "Three"] as const;

function Harness() {
  const [active, setActive] = useState<(typeof TABS)[number]>("One");
  const { tablistProps, tabProps, panelProps } = useTabs({
    tabs: TABS, active, onChange: setActive, label: "Sections",
  });
  return (
    <>
      <div {...tablistProps}>
        {TABS.map((name) => (
          <button key={name} type="button" {...tabProps(name)}>{name}</button>
        ))}
      </div>
      <div {...panelProps(active)}>{active} content</div>
    </>
  );
}

describe("useTabs", () => {
  it("points each tab at a panel that exists", () => {
    render(<Harness />);
    const tab = screen.getByRole("tab", { name: "One" });

    const panel = screen.getByRole("tabpanel");
    expect(tab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
  });

  it("moves between tabs with the arrow keys", async () => {
    render(<Harness />);
    screen.getByRole("tab", { name: "One" }).focus();

    await userEvent.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
  });

  it("wraps around at the ends", async () => {
    render(<Harness />);
    screen.getByRole("tab", { name: "One" }).focus();

    await userEvent.keyboard("{ArrowLeft}");

    expect(screen.getByRole("tab", { name: "Three" })).toHaveAttribute("aria-selected", "true");
  });

  it("uses a roving tabindex so Tab enters the group once", () => {
    render(<Harness />);

    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("tabindex", "-1");
  });
});
