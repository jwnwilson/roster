import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders a fill width proportional to value", () => {
    const { container } = render(<ProgressBar value={0.5} />);
    const fill = container.querySelector("[data-fill]") as HTMLElement;
    expect(fill.style.width).toBe("50%");
  });
  it("clamps out-of-range values", () => {
    const { container } = render(<ProgressBar value={1.5} />);
    expect((container.querySelector("[data-fill]") as HTMLElement).style.width).toBe("100%");
  });
});
