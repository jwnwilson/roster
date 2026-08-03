import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { AgentsScreen } from "./AgentsScreen";
import { failure, okList } from "../../mocks/envelope";
import { agent, brokenAgent } from "../../mocks/fixtures";
import { server } from "../../mocks/server";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("AgentsScreen", () => {
  it("lists each agent with its model and skills", async () => {
    renderWithProviders(<AgentsScreen />);

    const row = await screen.findByRole("row", { name: new RegExp(agent.name, "i") });
    expect(within(row).getByText(agent.model)).toBeInTheDocument();
    expect(within(row).getByText(String(agent.skills.length))).toBeInTheDocument();
  });

  it("shows the reason a disabled agent is disabled", async () => {
    // The backend surfaces a malformed folder this way deliberately; hiding it
    // would waste the whole disabled-with-reason mechanism.
    renderWithProviders(<AgentsScreen />);

    expect(await screen.findByText(brokenAgent.problem!)).toBeInTheDocument();
  });

  it("filters to the agents currently taking a turn", async () => {
    renderWithProviders(<AgentsScreen />);
    await screen.findByText(agent.name);

    await userEvent.click(screen.getByRole("button", { name: /^working$/i }));

    expect(screen.getByText(agent.name)).toBeInTheDocument();
    expect(screen.queryByText(brokenAgent.name)).not.toBeInTheDocument();
  });

  it("says an agent folder is read from disk, never stored by roster", async () => {
    renderWithProviders(<AgentsScreen />);

    expect(await screen.findByText(/read from disk/i)).toBeInTheDocument();
  });

  it("renders an empty state when there are no agent folders", async () => {
    server.use(http.get("/api/agents", () => okList([])));
    renderWithProviders(<AgentsScreen />);

    expect(await screen.findByText(/no agent folders/i)).toBeInTheDocument();
  });

  it("surfaces an error state when the listing fails", async () => {
    server.use(http.get("/api/agents", () => failure(500, "boom")));
    renderWithProviders(<AgentsScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });
});
