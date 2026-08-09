import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ChatPanel } from "./ChatPanel";
import { renderWithProviders } from "../test/renderWithProviders";

describe("ChatPanel", () => {
  it("shows the project's lead-agent conversation", async () => {
    // The chat panel's thread is the one with no work item (spec §4).
    renderWithProviders(<ChatPanel projectId="p1" />);

    expect(await screen.findByText(/what should we pick up first/i)).toBeInTheDocument();
  });

  it("does not show a conversation scoped to a work item", async () => {
    renderWithProviders(<ChatPanel projectId="p1" />);
    await screen.findByText(/what should we pick up first/i);

    // leadMessages and messages differ deliberately, so reading the wrong
    // thread fails here rather than rendering something plausible.
    expect(screen.queryByText(/go ahead and start on this/i)).not.toBeInTheDocument();
  });

  it("collapses to the strip and remembers it", async () => {
    renderWithProviders(<ChatPanel projectId="p1" />);

    await userEvent.click(screen.getByRole("button", { name: /collapse chat/i }));

    expect(screen.getByRole("button", { name: /expand chat/i })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("roster.chat.open")!)).toBe(false);
  });
});

describe("ChatPanel — replying", () => {
  it("can reply to the lead agent, which the registry already claimed", async () => {
    // The panel listed threads.post as a consumed capability while rendering
    // only titles — the registry overstated it until now.
    renderWithProviders(<ChatPanel projectId="p1" />);

    expect(await screen.findByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
  });

  it("shows the conversation, not just its title", async () => {
    renderWithProviders(<ChatPanel projectId="p1" />);

    expect(await screen.findByText(/what should we pick up first/i)).toBeInTheDocument();
  });
});
