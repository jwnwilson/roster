import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the right label per kind", () => {
    render(<StatusBadge kind="action_needed" />);
    expect(screen.getByText(/ACTION NEEDED/i)).toBeInTheDocument();
  });
  it("renders RUNNING for the running kind", () => {
    render(<StatusBadge kind="running" />);
    expect(screen.getByText(/RUNNING/i)).toBeInTheDocument();
  });
});
