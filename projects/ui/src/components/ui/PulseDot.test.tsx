import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PulseDot } from "./PulseDot";

describe("PulseDot", () => {
  it("renders a sized element with the pulse animation", () => {
    const { container } = render(<PulseDot size={6} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("6px");
    expect(el.className).toContain("pulse");
  });
});
