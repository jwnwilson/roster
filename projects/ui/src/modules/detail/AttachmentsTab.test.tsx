import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AttachmentsTab } from "./AttachmentsTab";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("AttachmentsTab", () => {
  it("distinguishes what an agent produced from what was uploaded", () => {
    renderWithProviders(<AttachmentsTab />);

    // Scoped to the file list: "Agent output" is also a filter button, and
    // matching that instead would prove nothing about the rows.
    const files = screen.getByRole("list");
    expect(within(files).getByText("Agent output")).toBeInTheDocument();
    expect(within(files).getByText("Uploaded")).toBeInTheDocument();
  });

  it("filters to agent output", async () => {
    renderWithProviders(<AttachmentsTab />);

    await userEvent.click(screen.getByRole("button", { name: "Agent output" }));

    expect(screen.getByText("summary.md")).toBeInTheDocument();
    expect(screen.queryByText("architecture.png")).not.toBeInTheDocument();
  });

  it("shows a readable size rather than a byte count", () => {
    renderWithProviders(<AttachmentsTab />);

    expect(within(screen.getByRole("list")).getByText(/1\.2 MB/)).toBeInTheDocument();
  });

  it("offers upload but says it keeps nothing", () => {
    renderWithProviders(<AttachmentsTab />);

    expect(screen.getByText(/drop files here/i)).toBeInTheDocument();
    expect(screen.getByText(/uploads are not kept/i)).toBeInTheDocument();
  });

  it("is visibly mocked", () => {
    renderWithProviders(<AttachmentsTab />);

    expect(screen.getByTestId("data-source-badge")).toBeInTheDocument();
  });
});
