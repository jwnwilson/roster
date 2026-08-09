import { screen, within } from "@testing-library/react";
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

describe("DetailScreen — Thread tab", () => {
  it("shows this item's conversation, which is where agent output is read", async () => {
    show();
    await screen.findByText(workItem.key);

    await userEvent.click(screen.getByRole("tab", { name: "Thread" }));

    // Handoff §D3: the same thread, scoped to this item. There is no separate
    // agent-monitor tab (spec §6).
    expect(await screen.findByText(/read the config|go ahead and start/i)).toBeInTheDocument();
  });

  it("says so when the item has no conversation yet", async () => {
    server.use(http.get("/api/threads", () => okList([])));
    show();
    await screen.findByText(workItem.key);

    await userEvent.click(screen.getByRole("tab", { name: "Thread" }));

    expect(await screen.findByText(/no conversation on this work item yet/i)).toBeInTheDocument();
  });
});

describe("DetailScreen — Thread tab scoping", () => {
  it("shows this item's thread, not the lead-agent conversation", async () => {
    // The mock handler now honours work_item_id. Before it did not, so the tab
    // rendered results[0] — the lead thread — and no test could tell.
    show();
    await screen.findByText(workItem.key);

    await userEvent.click(screen.getByRole("tab", { name: "Thread" }));

    expect(await screen.findByText(/go ahead and start on this/i)).toBeInTheDocument();
    expect(screen.queryByText(/what should we pick up first/i)).not.toBeInTheDocument();
  });
});

describe("DetailScreen — the right rail (handoff §Screen D, 252px)", () => {
  it("exists beside the tab body", async () => {
    show();

    expect(await screen.findByTestId("detail-rail")).toBeInTheDocument();
  });

  it("shows the item's real properties", async () => {
    show();

    // Scoped to the properties list: "atlas" is also an activity actor further
    // down the same rail, and matching that would prove nothing.
    await screen.findByTestId("detail-rail");
    const properties = screen.getByTestId("rail-properties");
    expect(within(properties).getByText("In Progress")).toBeInTheDocument();
    expect(within(properties).getByText(workItem.agent_name!)).toBeInTheDocument();
  });

  it("says Unassigned rather than blank when no agent is assigned", async () => {
    server.use(http.get("/api/work-items", () => okList([{ ...workItem, agent_name: null }])));
    show();

    await screen.findByTestId("detail-rail");
    expect(within(screen.getByTestId("rail-properties")).getByText(/unassigned/i))
      .toBeInTheDocument();
  });

  it("badges token usage, which no entity carries, but not the properties", async () => {
    show();

    const rail = await screen.findByTestId("detail-rail");
    expect(within(rail).getAllByTestId("data-source-badge").length).toBe(1);
  });

  it("carries all four sections the handoff specifies", async () => {
    show();

    const rail = await screen.findByTestId("detail-rail");
    for (const title of ["PROPERTIES", "TOKEN USAGE", "RECENT ACTIVITY", "ATTACHMENTS"]) {
      expect(within(rail).getByText(title)).toBeInTheDocument();
    }
  });
});
