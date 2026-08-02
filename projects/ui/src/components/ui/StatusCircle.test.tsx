import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusCircle } from "./StatusCircle";

describe("StatusCircle", () => {
  it("renders an svg sized to the prop", () => {
    const { container } = render(<StatusCircle status="todo" size={13} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("13");
  });

  it("renders the done variant with a check path", () => {
    const { container } = render(<StatusCircle status="done" />);
    expect(container.querySelector("path")).toBeInTheDocument();
  });

  it("uses an accent arc for in_progress", () => {
    const { container } = render(<StatusCircle status="in_progress" />);
    expect(container.innerHTML.toLowerCase()).toContain("#7c6cf0");
  });
});
