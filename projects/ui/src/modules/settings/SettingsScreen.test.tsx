import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SettingsScreen } from "./SettingsScreen";
import { secrets } from "../../mocks/unbacked/secrets.list";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("SettingsScreen", () => {
  it("shows the four sections this design revision kept", () => {
    renderWithProviders(<SettingsScreen />);

    for (const group of ["WORKSPACE", "BILLING", "INTEGRATIONS", "SECURITY"]) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
  });

  it("has no Agents, Models or Tools section", () => {
    // Removed in this revision: agents are configured from their folder on disk
    // and tools from their MCP server, so a settings page for them would be a
    // second place to change something roster does not own.
    renderWithProviders(<SettingsScreen />);

    for (const gone of [/^agents$/i, /^models$/i, /^tools$/i]) {
      expect(screen.queryByRole("button", { name: gone })).not.toBeInTheDocument();
    }
  });

  it("lists each secret by name", () => {
    renderWithProviders(<SettingsScreen />);

    expect(screen.getByText(secrets[0].name)).toBeInTheDocument();
  });

  it("never renders a secret value in plain text", () => {
    // The habit matters more than the fixture: there is no value field at all,
    // so there is nothing for the UI to leak by accident.
    renderWithProviders(<SettingsScreen />);

    for (const secret of secrets) {
      expect(Object.keys(secret)).not.toContain("value");
    }
    expect(document.body.textContent).not.toMatch(/ghp_|sk-|lin_api_/);
  });

  it("says when a secret has never been used rather than showing a blank", () => {
    renderWithProviders(<SettingsScreen />);

    expect(screen.getByText("never")).toBeInTheDocument();
  });

  it("says a section is not built rather than rendering nothing", async () => {
    renderWithProviders(<SettingsScreen />);

    await userEvent.click(screen.getByRole("button", { name: "General" }));

    expect(screen.getByText(/general is not built yet/i)).toBeInTheDocument();
  });
});
