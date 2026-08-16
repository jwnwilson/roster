import { screen, within } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { LiveAgentsRibbon } from "./LiveAgentsRibbon";
import { okList } from "../../mocks/envelope";
import { agent, brokenAgent, codexAgent } from "../../mocks/fixtures";
import { server } from "../../mocks/server";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("LiveAgentsRibbon", () => {
  it("exists on the board — handoff §Screen B, 76px", async () => {
    renderWithProviders(<LiveAgentsRibbon />);

    const ribbon = await screen.findByTestId("live-agents-ribbon");
    expect(within(ribbon).getByText(/LIVE AGENTS/)).toBeInTheDocument();
  });

  it("shows a working agent as a running chip", async () => {
    renderWithProviders(<LiveAgentsRibbon />);

    const chip = await screen.findByTestId(`agent-chip-${agent.name}`);
    expect(chip).toHaveAttribute("data-state", "working");
    expect(within(chip).getByText(agent.name)).toBeInTheDocument();
  });

  it("shows an agent that is not working as idle, not as missing", async () => {
    server.use(http.get("/api/agents", () => okList([{ ...agent, status: "active" }])));
    renderWithProviders(<LiveAgentsRibbon />);

    const chip = await screen.findByTestId(`agent-chip-${agent.name}`);
    expect(chip).toHaveAttribute("data-state", "idle");
    expect(within(chip).getByText(/awaiting task/i)).toBeInTheDocument();
  });

  it("leaves a disabled agent out — it cannot be taking a turn", async () => {
    renderWithProviders(<LiveAgentsRibbon />);
    await screen.findByTestId(`agent-chip-${agent.name}`);

    expect(screen.queryByTestId(`agent-chip-${brokenAgent.name}`)).not.toBeInTheDocument();
  });

  it("says so when there are no agent folders at all", async () => {
    server.use(http.get("/api/agents", () => okList([])));
    renderWithProviders(<LiveAgentsRibbon />);

    expect(await screen.findByText(/no agents configured/i)).toBeInTheDocument();
  });
});

describe("LiveAgentsRibbon — the handoff's colours, not approximations of them", () => {
  it("does not advertise an idle agent in the colour that means running", async () => {
    // §Screen B: RUN is #7c6cf0, IDLE is #22252c — a grey that all but disappears.
    // One ternary switched the word and not the class, so every idle chip wore
    // accent violet. 24 board tests passed throughout: none looked at colour.
    // An *idle* agent, not a disabled one: the ribbon omits disabled folders,
    // because a broken folder cannot be between jobs.
    server.use(http.get("/api/agents", () => okList([agent, codexAgent])));
    renderWithProviders(<LiveAgentsRibbon />);

    const chip = await screen.findByTestId(`agent-chip-${codexAgent.name}`);
    const label = within(chip).getByText("IDLE");

    expect(label.className).not.toMatch(/text-accent\b/);
    expect(label.className).toMatch(/text-text-7\b/);
  });

  it("keeps a working agent's RUN label in accent", async () => {
    renderWithProviders(<LiveAgentsRibbon />);

    const chip = await screen.findByTestId("agent-chip-atlas");

    expect(within(chip).getByText("RUN").className).toMatch(/text-accent\b/);
  });
});
