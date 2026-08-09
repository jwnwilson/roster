import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it } from "vitest";

import { ThreadsScreen } from "./ThreadsScreen";
import { failure, ok, okList } from "../../mocks/envelope";
import { leadThread, messages, thread } from "../../mocks/fixtures";
import { server } from "../../mocks/server";
import { renderWithProviders } from "../../test/renderWithProviders";

describe("ThreadsScreen", () => {
  it("offers only the two tabs the design specifies", async () => {
    renderWithProviders(<ThreadsScreen />);

    expect(await screen.findByRole("tab", { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /action needed/i })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("filters to the threads awaiting the operator", async () => {
    renderWithProviders(<ThreadsScreen />);
    await screen.findByText(leadThread.title);

    await userEvent.click(screen.getByRole("tab", { name: /action needed/i }));

    expect(screen.queryByText(leadThread.title)).not.toBeInTheDocument();
    expect(screen.getByText(thread.title)).toBeInTheDocument();
  });

  it("shows each thread's badge from its stored status", async () => {
    renderWithProviders(<ThreadsScreen />);

    const row = await screen.findByRole("button", { name: new RegExp(thread.title, "i") });
    expect(within(row).getByText(/action needed/i)).toBeInTheDocument();
  });

  it("opens a thread's messages when it is selected", async () => {
    renderWithProviders(<ThreadsScreen />);

    await userEvent.click(await screen.findByRole("button", { name: new RegExp(thread.title, "i") }));

    expect(await screen.findByText(messages[0].content)).toBeInTheDocument();
  });

  it("renders a file_write differently from ordinary text", async () => {
    renderWithProviders(<ThreadsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(thread.title, "i") }));

    expect(await screen.findByTestId("message-file_write")).toHaveTextContent(messages[1].content);
  });

  it("surfaces a repeat resolve as a readable message rather than a crash", async () => {
    // 409 is the guarantee that memory is written once, not an error to hide.
    server.use(http.patch("/api/threads/:id", () =>
      failure(409, "cannot move thread from resolved to resolved")));
    renderWithProviders(<ThreadsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(thread.title, "i") }));

    await userEvent.click(screen.getByRole("button", { name: /resolve/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already resolved|resolved to resolved/i);
  });

  it("renders an empty state when there are no threads", async () => {
    server.use(http.get("/api/threads", () => okList([])));
    renderWithProviders(<ThreadsScreen />);

    expect(await screen.findByText(/no threads yet/i)).toBeInTheDocument();
  });

  it("surfaces an error state when the listing fails", async () => {
    server.use(http.get("/api/threads", () => failure(500, "boom")));
    renderWithProviders(<ThreadsScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });

  it("is fully live, so it carries no mocked badge", async () => {
    renderWithProviders(<ThreadsScreen />);
    await screen.findByText(leadThread.title);

    expect(screen.queryByTestId("data-source-badge")).not.toBeInTheDocument();
  });

  it("marks a thread read", async () => {
    let patched: unknown = null;
    server.use(http.patch("/api/threads/:id", async ({ request }) => {
      patched = await request.json();
      return ok({ ...thread, read: true });
    }));
    renderWithProviders(<ThreadsScreen />);

    await userEvent.click(await screen.findByRole("button", { name: new RegExp(thread.title, "i") }));

    expect(patched).toEqual({ read: true });
  });
});

describe("ThreadsScreen — replying", () => {
  it("can answer an agent's question", async () => {
    // Without this the core loop is broken: an agent asks, the badge appears,
    // and there is no way to respond.
    const sent: Record<string, unknown>[] = [];
    server.use(http.post("/api/threads/:id/messages", async ({ request }) => {
      sent.push((await request.json()) as Record<string, unknown>);
      return ok(messages[0]);
    }));
    renderWithProviders(<ThreadsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(thread.title, "i") }));

    await userEvent.type(await screen.findByRole("textbox"), "Yes, cover the tests too");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(sent[0]).toMatchObject({ author_kind: "user", content: "Yes, cover the tests too" });
  });

  it("names the agent so the reply starts its turn", async () => {
    const sent: Record<string, unknown>[] = [];
    server.use(http.post("/api/threads/:id/messages", async ({ request }) => {
      sent.push((await request.json()) as Record<string, unknown>);
      return ok(messages[0]);
    }));
    renderWithProviders(<ThreadsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(thread.title, "i") }));

    await userEvent.type(await screen.findByRole("textbox"), "go on");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(sent[0].agent_name).toBe("atlas");
  });

  it("will not send an empty reply", async () => {
    renderWithProviders(<ThreadsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(thread.title, "i") }));

    expect(await screen.findByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("says why a resolved thread cannot be replied to", async () => {
    server.use(http.get("/api/threads", () => okList([{ ...thread, status: "resolved" }])));
    renderWithProviders(<ThreadsScreen />);

    await userEvent.click(await screen.findByRole("button", { name: new RegExp(thread.title, "i") }));

    expect(await screen.findByText(/reopen it to reply/i)).toBeInTheDocument();
  });

  it("says the filter is empty rather than rendering a blank pane", async () => {
    server.use(http.get("/api/threads", () => okList([leadThread])));
    renderWithProviders(<ThreadsScreen />);
    await screen.findByText(leadThread.title);

    await userEvent.click(screen.getByRole("tab", { name: /action needed/i }));

    expect(screen.getByText(/no threads need action/i)).toBeInTheDocument();
  });
});

describe("ThreadsScreen — header controls spec §6 names", () => {
  it("offers a project filter", async () => {
    renderWithProviders(<ThreadsScreen />);

    const filter = await screen.findByLabelText(/filter by project/i);
    expect(within(filter).getByRole("option", { name: "api-service" })).toBeInTheDocument();
  });

  it("narrows the list to one project", async () => {
    renderWithProviders(<ThreadsScreen />);
    await screen.findByText(leadThread.title);

    await userEvent.selectOptions(screen.getByLabelText(/filter by project/i), "p2");

    // p2 is the infra project; neither seeded thread belongs to it.
    expect(await screen.findByText(/no threads yet/i)).toBeInTheDocument();
  });

  it("shows how many threads are unread", async () => {
    renderWithProviders(<ThreadsScreen />);

    expect(await screen.findByTestId("unread-count")).toHaveTextContent("2");
  });

  it("marks every thread read at once", async () => {
    let called = false;
    server.use(http.post("/api/threads/mark-all-read", () => {
      called = true;
      return ok({ marked: 2 });
    }));
    renderWithProviders(<ThreadsScreen />);

    await userEvent.click(await screen.findByRole("button", { name: /mark all read/i }));

    expect(called).toBe(true);
  });
});
