import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ChatPanel } from "./ChatPanel";
import { renderWithProviders } from "../test/renderWithProviders";

describe("ChatPanel", () => {
  it("shows the project's lead-agent conversation", async () => {
    // The chat panel's threads are the ones with no work item (spec §4).
    renderWithProviders(<ChatPanel projectId="p1" />);

    expect(await screen.findByText(/plan the quarter/i)).toBeInTheDocument();
  });

  it("does not show a thread that is scoped to a work item", async () => {
    renderWithProviders(<ChatPanel projectId="p1" />);
    await screen.findByText(/plan the quarter/i);

    expect(screen.queryByText(/summarise the codebase/i)).not.toBeInTheDocument();
  });

  it("collapses to the strip and remembers it", async () => {
    renderWithProviders(<ChatPanel projectId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: /collapse chat/i }));

    expect(screen.getByRole("button", { name: /expand chat/i })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("roster.chat.open")!)).toBe(false);
  });
});
