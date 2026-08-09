import { render, screen, waitFor } from "@testing-library/react";
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

  it("moves focus as well as selection with the arrow keys", async () => {
    // Selection alone strands the user on a tabindex="-1" element that is no
    // longer selected: nothing is announced, and the next Tab exits the group.
    // The first version of this test asserted aria-selected only and missed it.
    render(<Harness />);
    screen.getByRole("tab", { name: "One" }).focus();

    await userEvent.keyboard("{ArrowRight}");

    const two = screen.getByRole("tab", { name: "Two" });
    await waitFor(() => expect(two).toHaveFocus());
    expect(two).toHaveAttribute("aria-selected", "true");
  });

  it("wraps around at the ends, focus included", async () => {
    render(<Harness />);
    screen.getByRole("tab", { name: "One" }).focus();

    await userEvent.keyboard("{ArrowLeft}");

    const three = screen.getByRole("tab", { name: "Three" });
    await waitFor(() => expect(three).toHaveFocus());
    expect(three).toHaveAttribute("aria-selected", "true");
  });

  it("points only the selected tab at a panel", () => {
    // The others' panels are not rendered, and an aria-controls resolving to
    // nothing is an ARIA violation — worse than making no promise at all.
    render(<Harness />);

    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-controls");
    expect(screen.getByRole("tab", { name: "Two" })).not.toHaveAttribute("aria-controls");
  });

  it("leaves no dangling aria-controls anywhere it is set", () => {
    render(<Harness />);

    for (const tab of screen.getAllByRole("tab")) {
      const target = tab.getAttribute("aria-controls");
      if (target) expect(document.getElementById(target)).not.toBeNull();
    }
  });

  it("uses a roving tabindex so Tab enters the group once", () => {
    render(<Harness />);

    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("tabindex", "-1");
  });
});
