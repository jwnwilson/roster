import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sidebar } from "./Sidebar";
import { renderWithProviders } from "../test/renderWithProviders";

describe("Sidebar", () => {
  it("shows the four nav destinations from the design", async () => {
    renderWithProviders(<Sidebar />);

    for (const label of ["Dashboard", "Threads", "Agents", "MCP Servers"]) {
      expect(screen.getByRole("link", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });

  it("does not show an Inbox destination", () => {
    // Threads replaced Inbox in this revision of the design.
    renderWithProviders(<Sidebar />);

    expect(screen.queryByRole("link", { name: /inbox/i })).not.toBeInTheDocument();
  });

  it("offers a way to create a project from the PROJECTS group header", () => {
    renderWithProviders(<Sidebar />);

    expect(screen.getByRole("button", { name: /new project/i })).toBeInTheDocument();
  });

  it("lists the projects from the API", async () => {
    renderWithProviders(<Sidebar />);

    expect(await screen.findByRole("link", { name: /api-service/i })).toBeInTheDocument();
  });

  it("uses a git glyph for a git project and a folder glyph otherwise", async () => {
    renderWithProviders(<Sidebar />);

    const git = await screen.findByRole("link", { name: /api-service/i });
    const local = await screen.findByRole("link", { name: /infra/i });

    expect(git.querySelector("[data-glyph='git']")).toBeInTheDocument();
    expect(local.querySelector("[data-glyph='folder']")).toBeInTheDocument();
  });

  it("marks the token budget footer as sample data", () => {
    renderWithProviders(<Sidebar />);

    expect(screen.getByTestId("token-budget")).toHaveAttribute("data-source", "unbacked");
  });
});
