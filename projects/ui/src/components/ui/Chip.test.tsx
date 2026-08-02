import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip } from "./Chip";

describe("Chip", () => {
  it("renders content and marks active state", () => {
    const { rerender, container } = render(<Chip>List</Chip>);
    expect(screen.getByText("List")).toBeInTheDocument();
    rerender(<Chip active>List</Chip>);
    expect((container.firstChild as HTMLElement).getAttribute("data-active")).toBe("true");
  });
});
