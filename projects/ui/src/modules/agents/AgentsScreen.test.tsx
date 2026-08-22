import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { AgentsScreen } from "./AgentsScreen";
import { failure, okList } from "../../mocks/envelope";
import { agent, brokenAgent, codexAgent } from "../../mocks/fixtures";
import { server } from "../../mocks/server";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("AgentsScreen", () => {
  it("lists each agent with its model and skills", async () => {
    renderWithProviders(<AgentsScreen />);

    const row = await screen.findByRole("row", { name: new RegExp(agent.name, "i") });
    expect(within(row).getByText(agent.model!)).toBeInTheDocument();
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

describe("AgentsScreen — which CLI an agent actually runs", () => {
  it("names the tool for every agent", async () => {
    // Verified against the running app on 2026-08-15: an agent with
    // `tool: codex` was indistinguishable from a Claude one, because the screen
    // rendered `model` and nothing else.
    server.use(
      http.get("/api/agents", () => okList([agent, codexAgent])),
    );
    renderWithProviders(<AgentsScreen />);

    const codexRow = await screen.findByRole("row", { name: new RegExp(codexAgent.name, "i") });
    expect(within(codexRow).getByText("codex")).toBeInTheDocument();

    const claudeRow = screen.getByRole("row", { name: new RegExp(agent.name, "i") });
    expect(within(claudeRow).getByText("claude")).toBeInTheDocument();
  });

  it("does not invent a model the operator never chose", async () => {
    // The bug in one assertion: `claude-opus-5` must not appear on a row for an
    // agent that runs codex and whose config.yaml names no model at all.
    server.use(
      http.get("/api/agents", () => okList([codexAgent])),
    );
    renderWithProviders(<AgentsScreen />);

    const row = await screen.findByRole("row", { name: new RegExp(codexAgent.name, "i") });
    expect(within(row).queryByText(/claude-opus-5/)).not.toBeInTheDocument();
    expect(within(row).getByText(/chosen by codex/i)).toBeInTheDocument();
  });
});

describe("AgentsScreen — the handoff's column grid", () => {
  it("fixes the column widths instead of letting content decide them", async () => {
    // §Screen C gives exact widths (292 118 1fr 168 76 …). The table was
    // `w-full` with none of them, so every column sized itself to its content
    // and nothing lined up with the design. Eighteen tests passed throughout;
    // none looked at layout.
    const { container } = renderWithProviders(<AgentsScreen />);
    await screen.findByRole("table");

    const table = container.querySelector("table")!;
    expect(table.className).toMatch(/table-fixed/);

    const widths = [...container.querySelectorAll("colgroup col")].map((c) => c.className);
    expect(widths[0]).toMatch(/w-\[292px\]/);
    expect(widths[1]).toMatch(/w-\[118px\]/);
  });
});
