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
