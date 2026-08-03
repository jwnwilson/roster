import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentDetailScreen } from "./AgentDetailScreen";
import { agent } from "../../mocks/fixtures";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("AgentDetailScreen", () => {
  it("shows the agent's instructions from its AGENT.md", async () => {
    renderWithProviders(<AgentDetailScreen name={agent.name} />);

    expect(await screen.findByDisplayValue(/roster's demo agent/i)).toBeInTheDocument();
  });

  it("does not present saving as something that works", async () => {
    // There are no agent write endpoints. A control that appears to save and
    // silently does nothing is worse than a disabled one with a reason.
    renderWithProviders(<AgentDetailScreen name={agent.name} />);

    expect(await screen.findByRole("button", { name: /save to disk/i })).toBeDisabled();
    expect(screen.getByText(/no write endpoint/i)).toBeInTheDocument();
  });

  it("shows the model from the agent's config.yaml", async () => {
    renderWithProviders(<AgentDetailScreen name={agent.name} />);

    expect(await screen.findByDisplayValue(agent.model)).toBeInTheDocument();
  });

  it("says so when there is no folder by that name", async () => {
    renderWithProviders(<AgentDetailScreen name="nobody" />);

    expect(await screen.findByText(/no agent folder called/i)).toBeInTheDocument();
  });
});
