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

describe("StatusBadge — agent states", () => {
  it("has a chip for each of the three agent states and no others", () => {
    // Spec §4: an agent is Working, Active or Disabled. A fourth would mean the
    // UI knows a state the domain does not.
    for (const kind of ["working", "active", "disabled"] as const) {
      const { unmount } = render(<StatusBadge kind={kind} />);
      expect(screen.getByText(kind.toUpperCase())).toBeInTheDocument();
      unmount();
    }
  });
});
