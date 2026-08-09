import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { BoardScreen } from "./BoardScreen";
import { CreateModalProvider } from "../create/CreateModalProvider";
import { workItem } from "../../mocks/fixtures";
import { renderWithProviders } from "../../test/renderWithProviders";

const show = (route = "/projects?project=p1") =>
  renderWithProviders(
    <CreateModalProvider>
      <BoardScreen />
    </CreateModalProvider>,
    { route },
  );

describe("BoardScreen", () => {
  it("renders the topbar the handoff specifies for every screen", async () => {
    show();

    expect(await screen.findByText("api-service")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new/i })).toBeInTheDocument();
  });

  it("defaults to the board and switches to the list", async () => {
    show();
    expect(await screen.findByTestId("column-in_progress")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /list/i }));

    // Screen A — required by spec §6 and previously unreachable.
    expect(await screen.findByTestId(`group-${workItem.status}`)).toBeInTheDocument();
    expect(screen.queryByTestId("column-in_progress")).not.toBeInTheDocument();
  });

  it("reads the view from the URL, so a list link opens as a list", async () => {
    // Asserted by rendering rather than by inspecting window.location, which
    // MemoryRouter never touches — that test would have proved nothing.
    show("/projects?project=p1&view=list");

    expect(await screen.findByTestId(`group-${workItem.status}`)).toBeInTheDocument();
    expect(screen.queryByTestId("column-in_progress")).not.toBeInTheDocument();
  });

  it("opens the work item modal from the New button", async () => {
    // Previously unreachable: CreateWorkItemModal was built, tested and had no
    // entry point anywhere in the running app.
    show();
    await screen.findByText("api-service");

    await userEvent.click(screen.getByRole("button", { name: /new/i }));

    expect(await screen.findByRole("heading", { name: /new work item/i })).toBeInTheDocument();
  });

  it("disables New when no project is chosen, since there is nothing to create against", async () => {
    show("/projects");

    expect(await screen.findByRole("button", { name: /new/i })).toBeDisabled();
  });

  it("shows where agents write, without offering a choice about it", async () => {
    // Spec §6: the artifact chip stays but is informational — the location is
    // fixed at <project folder>/.roster/artifacts.
    show();

    const chip = await screen.findByTestId("artifact-chip");
    expect(chip).toHaveAttribute("title", expect.stringContaining("/.roster/artifacts"));
    expect(chip.tagName).not.toBe("BUTTON");
  });

  it("lists work items grouped by status in the list view", async () => {
    show("/projects?project=p1&view=list");

    const group = await screen.findByTestId(`group-${workItem.status}`);
    expect(within(group).getByText(workItem.title)).toBeInTheDocument();
    expect(within(group).getByText(workItem.key)).toBeInTheDocument();
  });
});
