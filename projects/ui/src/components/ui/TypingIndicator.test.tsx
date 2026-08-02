import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TypingIndicator } from "./TypingIndicator";

describe("TypingIndicator", () => {
  it("renders three animated dots", () => {
    const { container } = render(<TypingIndicator />);
    const dots = container.querySelectorAll("[data-dot]");
    expect(dots).toHaveLength(3);
    expect((dots[0] as HTMLElement).className).toContain("pulse");
  });
});
