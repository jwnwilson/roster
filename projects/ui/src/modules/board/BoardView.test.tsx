import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { BoardView } from "./BoardView";
import { failure, ok, okList } from "../../mocks/envelope";
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

describe("BoardView — the column + button (§Screen B)", () => {
  it("gives every column a button that creates into that column", async () => {
    // CreateModalProvider's own comment promised "the sidebar's + and a board
    // column's + open the same thing". Only the sidebar's existed.
    renderWithProviders(<BoardView projectId="p1" />);

    const column = await screen.findByTestId("column-in_progress");
    const add = within(column).getByRole("button", { name: /add a work item to in progress/i });

    await userEvent.click(add);

    // Opening the form is not enough: the request has to carry the column that
    // was clicked, or the per-column button means nothing. Asserting the dialog
    // exists would pass with the status dropped entirely.
    let sent: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/work-items", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return ok({ ...workItem, status: "in_progress" });
      }),
    );

    await screen.findByRole("dialog");
    await userEvent.type(screen.getByLabelText(/title/i), "Something to do");
    await userEvent.click(screen.getByRole("button", { name: /create work item/i }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toMatchObject({ status: "in_progress", title: "Something to do" });
  });
});
