import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PriorityBars } from "./PriorityBars";

describe("PriorityBars", () => {
  it("always renders three bars", () => {
    const { container } = render(<PriorityBars priority="medium" />);
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(3);
  });

  it("fills more bars for higher priority", () => {
    const { container: low } = render(<PriorityBars priority="low" />);
    const { container: urgent } = render(<PriorityBars priority="urgent" />);
    const filled = (c: HTMLElement) =>
      [...c.querySelectorAll("[data-bar]")].filter((b) => b.getAttribute("data-filled") === "true").length;
    expect(filled(urgent.firstChild as HTMLElement)).toBeGreaterThan(filled(low.firstChild as HTMLElement));
  });
});
