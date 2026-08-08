import { screen, within } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { DashboardScreen } from "./DashboardScreen";
import { failure, okList } from "../../mocks/envelope";
import { agent, brokenAgent } from "../../mocks/fixtures";
import { server } from "../../mocks/server";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("DashboardScreen", () => {
  it("lists the agents currently taking a turn", async () => {
    renderWithProviders(<DashboardScreen />);

    const panel = await screen.findByTestId("active-agents");

    // Awaited inside the panel: it renders immediately with a loading state, so
    // a synchronous query here would run before the agents arrive.
    expect(await within(panel).findByText(agent.name)).toBeInTheDocument();
    expect(within(panel).queryByText(brokenAgent.name)).not.toBeInTheDocument();
  });

  it("shows an honest empty state rather than fabricating activity", async () => {
    server.use(http.get("/api/agents", () => okList([brokenAgent])));
    renderWithProviders(<DashboardScreen />);

    expect(await screen.findByText(/no agent is working right now/i)).toBeInTheDocument();
  });

  it("keeps the other panels rendered when the agents query fails", async () => {
    server.use(http.get("/api/agents", () => failure(500, "boom")));
    renderWithProviders(<DashboardScreen />);

    // One panel failing must not blank the screen.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("token-chart")).toBeInTheDocument();
    expect(screen.getByTestId("metric-cards")).toBeInTheDocument();
  });

  it("marks every panel that has no API behind it", async () => {
    renderWithProviders(<DashboardScreen />);
    await screen.findByTestId("active-agents");

    for (const panel of ["metric-cards", "token-chart", "activity-feed"]) {
      expect(within(screen.getByTestId(panel)).getByTestId("data-source-badge"))
        .toBeInTheDocument();
    }
  });

  it("does not badge the panel that is real", async () => {
    renderWithProviders(<DashboardScreen />);

    const panel = await screen.findByTestId("active-agents");
    await within(panel).findByText(/agents working/i);

    expect(within(panel).queryByTestId("data-source-badge")).not.toBeInTheDocument();
  });
});
