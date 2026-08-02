import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tag } from "./Tag";

describe("Tag", () => {
  it("renders its content", () => {
    render(<Tag>AUTH</Tag>);
    expect(screen.getByText("AUTH")).toBeInTheDocument();
  });
  it("applies accent styling for the accent tone", () => {
    const { container } = render(<Tag tone="accent">AUTH</Tag>);
    expect((container.firstChild as HTMLElement).className).toContain("accent");
  });
});
