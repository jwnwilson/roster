import { screen, within } from "@testing-library/react";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { BoardView } from "./BoardView";
import { failure, okList } from "../../mocks/envelope";
import { workItem } from "../../mocks/fixtures";
import { server } from "../../mocks/server";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("BoardView", () => {
  it("groups work items into the five status columns", async () => {
    renderWithProviders(<BoardView projectId="p1" />);

    for (const column of ["Backlog", "Todo", "In Progress", "In Review", "Done"]) {
      expect(await screen.findByRole("heading", { name: column })).toBeInTheDocument();
    }
  });

  it("shows a work item in the column matching its status", async () => {
    renderWithProviders(<BoardView projectId="p1" />);

    const column = await screen.findByTestId("column-in_progress");
    expect(within(column).getByText(workItem.title)).toBeInTheDocument();
  });

  it("shows the agent assigned to a work item", async () => {
    renderWithProviders(<BoardView projectId="p1" />);

    expect(await screen.findByTitle(/atlas/i)).toBeInTheDocument();
  });

  it("renders an empty state when the project has no work items", async () => {
    server.use(http.get("/api/work-items", () => okList([])));
    renderWithProviders(<BoardView projectId="p1" />);

    expect(await screen.findByText(/no work items yet/i)).toBeInTheDocument();
  });

  it("surfaces an error state when the request fails", async () => {
    server.use(http.get("/api/work-items", () => failure(500, "boom")));
    renderWithProviders(<BoardView projectId="p1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });

  it("marks the screen as partly mocked while token figures have no API", async () => {
    renderWithProviders(<BoardView projectId="p1" />);

    expect(await screen.findByTestId("data-source-badge")).toHaveTextContent(/1 mocked/i);
  });

  it("asks for a project rather than rendering an empty board when none is chosen", () => {
    // GET /work-items requires project_id — there is no all-projects listing.
    renderWithProviders(<BoardView projectId={undefined} />);

    expect(screen.getByText(/choose a project/i)).toBeInTheDocument();
  });
});
