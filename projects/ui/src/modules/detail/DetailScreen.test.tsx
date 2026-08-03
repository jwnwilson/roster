import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { DetailScreen } from "./DetailScreen";
import { failure, okList } from "../../mocks/envelope";
import { workItem } from "../../mocks/fixtures";
import { server } from "../../mocks/server";
import { renderWithProviders } from "../../test/renderWithProviders";

const show = () => renderWithProviders(<DetailScreen projectId="p1" itemId="w1" />);

describe("DetailScreen", () => {
  it("shows the item's key and title", async () => {
    show();

    expect(await screen.findByText(workItem.key)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: workItem.title })).toBeInTheDocument();
  });

  it("offers the four tabs the design specifies and no Agent tab", async () => {
    show();
    await screen.findByText(workItem.key);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Spec", "Attachments", "Activity", "Thread",
    ]);
  });

  it("renders the spec markdown on the default tab", async () => {
    show();

    // Asserted on body text, not the heading: the item title and the spec's own
    // h1 both mention the codebase, and matching either would prove nothing.
    expect(await screen.findByText(/MEMORY\.md/)).toBeInTheDocument();
  });

  it("surfaces an illegal transition as a readable message rather than a crash", async () => {
    server.use(http.patch("/api/work-items/:id", () =>
      failure(409, "cannot move work item from done to backlog")));
    show();
    await screen.findByText(workItem.key);

    await userEvent.selectOptions(await screen.findByLabelText(/status/i), "backlog");

    expect(await screen.findByRole("alert"))
      .toHaveTextContent(/cannot move work item from done to backlog/i);
  });

  it("reports an invalid status value as a client fault, not a user error", async () => {
    // 422 means the UI sent something the API does not accept — a bug here, not
    // a legitimate move the rules forbid.
    server.use(http.patch("/api/work-items/:id", () =>
      failure(422, "status: not a valid enumeration member")));
    show();
    await screen.findByText(workItem.key);

    await userEvent.selectOptions(await screen.findByLabelText(/status/i), "backlog");

    expect(await screen.findByRole("alert")).toHaveTextContent(/unexpected/i);
  });

  it("lists activity newest first and marks it as sample data", async () => {
    show();
    await screen.findByText(workItem.key);

    await userEvent.click(screen.getByRole("tab", { name: "Activity" }));

    const entries = await screen.findAllByRole("listitem");
    expect(entries[0]).toHaveTextContent(/moved this to In Progress/i);
    // Two badges are correct here — the header's (readOne is unbacked) and the
    // activity panel's own — so this asserts presence, not uniqueness.
    expect(screen.getAllByTestId("data-source-badge").length).toBeGreaterThan(0);
  });

  it("says so when the item is not in the project's listing", async () => {
    server.use(http.get("/api/work-items", () => okList([])));
    show();

    expect(await screen.findByText(/could not find that work item/i)).toBeInTheDocument();
  });

  it("surfaces an error state when the listing fails", async () => {
    server.use(http.get("/api/work-items", () => failure(500, "boom")));
    show();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });
});
