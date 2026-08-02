import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Topbar } from "./Topbar";

describe("Topbar", () => {
  it("shows the title and count and toggles the view", async () => {
    const onViewChange = vi.fn();
    render(<Topbar title="Projects" count={12} view="board" onViewChange={onViewChange} onNew={() => {}} />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /list/i }));
    expect(onViewChange).toHaveBeenCalledWith("list");
  });

  it("fires onNew", async () => {
    const onNew = vi.fn();
    render(<Topbar title="Projects" count={0} view="board" onViewChange={() => {}} onNew={onNew} />);
    await userEvent.click(screen.getByRole("button", { name: /new/i }));
    expect(onNew).toHaveBeenCalledOnce();
  });
});
