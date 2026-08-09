import { screen, within } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { okList } from "../../mocks/envelope";
import { server } from "../../mocks/server";

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

describe("AgentDetailScreen — the right rail (handoff §C2, 372px)", () => {
  it("exists beside the AGENT.md editor", async () => {
    renderWithProviders(<AgentDetailScreen name={agent.name} />);

    expect(await screen.findByTestId("agent-detail-rail")).toBeInTheDocument();
  });

  it("carries the three sections the handoff specifies", async () => {
    renderWithProviders(<AgentDetailScreen name={agent.name} />);

    const rail = await screen.findByTestId("agent-detail-rail");
    for (const title of ["CONFIG.YAML", "SKILLS", "MCP SERVERS"]) {
      expect(within(rail).getByText(title)).toBeInTheDocument();
    }
  });

  it("shows the config.yaml values, not just the model", async () => {
    renderWithProviders(<AgentDetailScreen name={agent.name} />);

    const rail = await screen.findByTestId("agent-detail-rail");
    expect(within(rail).getByText(agent.token_limit.toLocaleString())).toBeInTheDocument();
    expect(within(rail).getByText(String(agent.temperature))).toBeInTheDocument();
  });

  it("says so when an agent folder has no skills", async () => {
    server.use(http.get("/api/agents", () => okList([{ ...agent, skills: [] }])));
    renderWithProviders(<AgentDetailScreen name={agent.name} />);

    const rail = await screen.findByTestId("agent-detail-rail");
    expect(within(rail).getByText(/no skills folder/i)).toBeInTheDocument();
  });
});
