import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the right label per kind", () => {
    render(<StatusBadge kind="action_needed" />);
    expect(screen.getByText(/ACTION NEEDED/i)).toBeInTheDocument();
  });
  it("renders WORKING for the working kind", () => {
    render(<StatusBadge kind="working" />);
    expect(screen.getByText(/WORKING/i)).toBeInTheDocument();
  });
});
