import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { McpDetailScreen } from "./McpDetailScreen";
import { McpServersScreen } from "./McpServersScreen";
import { mcpServers } from "../../mocks/unbacked/mcp.servers";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("McpServersScreen", () => {
  it("lists each server with its transport and tool count", async () => {
    renderWithProviders(<McpServersScreen />);

    const row = await screen.findByRole("row", { name: /github/i });
    expect(within(row).getByText("http")).toBeInTheDocument();
    expect(within(row).getByTestId("tool-count")).toHaveTextContent("3");
  });

  it("raises the server that needs attention, in plain language", () => {
    renderWithProviders(<McpServersScreen />);

    expect(screen.getByText(/1 server needs attention/i)).toBeInTheDocument();
    expect(screen.getByText(/token expired 2 days ago/i)).toBeInTheDocument();
  });

  it("filters to the connected servers", async () => {
    renderWithProviders(<McpServersScreen />);

    await userEvent.click(screen.getByRole("button", { name: /^connected$/i }));

    expect(screen.getByText("github")).toBeInTheDocument();
    expect(screen.queryByText("filesystem")).not.toBeInTheDocument();
  });

  it("is visibly mocked", () => {
    renderWithProviders(<McpServersScreen />);

    expect(screen.getByTestId("data-source-badge")).toBeInTheDocument();
  });
});

describe("McpDetailScreen", () => {
  it("agrees with the list row on the number of tools exposed", async () => {
    // The handoff calls this out explicitly: the two views must not disagree.
    const list = renderWithProviders(<McpServersScreen />);
    const listed = within(await screen.findByRole("row", { name: /github/i }))
      .getByTestId("tool-count").textContent;
    list.unmount();

    renderWithProviders(<McpDetailScreen name="github" />);

    expect(screen.getByTestId("tools-exposed")).toHaveTextContent(listed!);
  });

  it("shows the auth secret by name and never its value", () => {
    renderWithProviders(<McpDetailScreen name="github" />);

    expect(screen.getByText("GITHUB_TOKEN")).toBeInTheDocument();
    expect(screen.getByText(/from secrets/i)).toBeInTheDocument();
  });

  it("toggles a tool locally and says the change is not saved", async () => {
    renderWithProviders(<McpDetailScreen name="github" />);
    const toggle = screen.getByRole("switch", { name: "search_code" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/not saved/i)).toBeInTheDocument();
  });

  it("shows each agent's access scope", () => {
    renderWithProviders(<McpDetailScreen name="github" />);

    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  it("marks a denied call so it does not read as a success", () => {
    renderWithProviders(<McpDetailScreen name="github" />);

    expect(screen.getByTestId("call-c2")).toHaveTextContent(/denied/i);
  });

  it("says so when there is no server by that name", () => {
    renderWithProviders(<McpDetailScreen name="nope" />);

    expect(screen.getByText(/no mcp server called/i)).toBeInTheDocument();
  });

  it("renders every server in the fixtures without crashing", () => {
    // A fixture the screen cannot render is a trap for whoever wires the real
    // API up later — including the one with no tools and no calls.
    for (const server of mcpServers) {
      const view = renderWithProviders(<McpDetailScreen name={server.name} />);
      expect(screen.getByRole("heading", { name: server.name })).toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("McpDetailScreen — the right rail (handoff §K2, 392px)", () => {
  it("exists beside the connection column", () => {
    renderWithProviders(<McpDetailScreen name="github" />);

    expect(screen.getByTestId("mcp-detail-rail")).toBeInTheDocument();
  });

  it("carries the tools and per-agent access the handoff puts there", () => {
    renderWithProviders(<McpDetailScreen name="github" />);

    const rail = screen.getByTestId("mcp-detail-rail");
    expect(within(rail).getByText("TOOLS")).toBeInTheDocument();
    expect(within(rail).getByText("AGENT ACCESS")).toBeInTheDocument();
    expect(within(rail).getByRole("switch", { name: "search_code" })).toBeInTheDocument();
  });
});
