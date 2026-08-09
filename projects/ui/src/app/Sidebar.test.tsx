import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sidebar } from "./Sidebar";
import { CreateModalProvider } from "../modules/create/CreateModalProvider";
import { renderWithProviders } from "../test/renderWithProviders";

describe("Sidebar", () => {
  it("shows the four nav destinations from the design", async () => {
    renderWithProviders(
      <CreateModalProvider>
        <Sidebar />
      </CreateModalProvider>,
    );

    for (const label of ["Dashboard", "Threads", "Agents", "MCP Servers"]) {
      expect(screen.getByRole("link", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });

  it("does not show an Inbox destination", () => {
    // Threads replaced Inbox in this revision of the design.
    renderWithProviders(
      <CreateModalProvider>
        <Sidebar />
      </CreateModalProvider>,
    );

    expect(screen.queryByRole("link", { name: /inbox/i })).not.toBeInTheDocument();
  });

  it("offers a way to create a project from the PROJECTS group header", () => {
    renderWithProviders(
      <CreateModalProvider>
        <Sidebar />
      </CreateModalProvider>,
    );

    expect(screen.getByRole("button", { name: /new project/i })).toBeInTheDocument();
  });

  it("lists the projects from the API", async () => {
    renderWithProviders(
      <CreateModalProvider>
        <Sidebar />
      </CreateModalProvider>,
    );

    expect(await screen.findByRole("link", { name: /api-service/i })).toBeInTheDocument();
  });

  it("uses a git glyph for a git project and a folder glyph otherwise", async () => {
    renderWithProviders(
      <CreateModalProvider>
        <Sidebar />
      </CreateModalProvider>,
    );

    const git = await screen.findByRole("link", { name: /api-service/i });
    const local = await screen.findByRole("link", { name: /infra/i });

    expect(git.querySelector("[data-glyph='git']")).toBeInTheDocument();
    expect(local.querySelector("[data-glyph='folder']")).toBeInTheDocument();
  });

  it("marks the token budget footer as sample data", () => {
    renderWithProviders(
      <CreateModalProvider>
        <Sidebar />
      </CreateModalProvider>,
    );

    expect(screen.getByTestId("token-budget")).toHaveAttribute("data-source", "unbacked");
  });
});

describe("Sidebar — project selection", () => {
  it("marks only the selected project as current", async () => {
    // NavLink ignores the query string, so every project used to render active
    // at once — and several aria-current="page" in one nav is its own defect.
    renderWithProviders(
      <CreateModalProvider>
        <Sidebar />
      </CreateModalProvider>,
      { route: "/projects?project=p1" },
    );

    const selected = await screen.findByRole("link", { name: /api-service/i });
    const other = await screen.findByRole("link", { name: /infra/i });

    expect(selected).toHaveAttribute("aria-current", "page");
    expect(other).not.toHaveAttribute("aria-current");
  });

  it("marks none as current when no project is chosen", async () => {
    renderWithProviders(
      <CreateModalProvider>
        <Sidebar />
      </CreateModalProvider>,
      { route: "/threads" },
    );

    const projects = await screen.findAllByRole("link", { name: /api-service|infra/i });
    for (const link of projects) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });
});
