import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";
import { renderWithProviders } from "../test/renderWithProviders";

describe("AppShell", () => {
  it("keeps the navigation rendered when a route throws", () => {
    const Boom = () => {
      throw new Error("kaboom");
    };
    // The boundary logs the trace; silence it so the run stays readable.
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithProviders(
      <AppShell>
        <Boom />
      </AppShell>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/something went wrong/i);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
