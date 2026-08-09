import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children and fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>New</Button>);
    await userEvent.click(screen.getByText("New"));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("primary variant uses the accent background", () => {
    const { container } = render(<Button variant="primary">Go</Button>);
    expect((container.firstChild as HTMLElement).className).toContain("bg-accent");
  });
});
