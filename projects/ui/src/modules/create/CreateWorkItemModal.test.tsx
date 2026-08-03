import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it, vi } from "vitest";

import { CreateWorkItemModal } from "./CreateWorkItemModal";
import { created, okList } from "../../mocks/envelope";
import { workItem } from "../../mocks/fixtures";
import { server } from "../../mocks/server";
import { renderWithProviders } from "../../test/renderWithProviders";

const show = (onClose = vi.fn()) =>
  renderWithProviders(<CreateWorkItemModal projectId="p1" onClose={onClose} />);

describe("CreateWorkItemModal", () => {
  it("offers the three work item types", () => {
    show();

    for (const label of ["Epic", "Feature", "Task"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("does not ask an epic for a parent", async () => {
    // The API rejects an epic that carries one; the form should make that
    // unreachable rather than rely on the 400.
    show();

    await userEvent.click(screen.getByRole("radio", { name: "Epic" }));

    expect(screen.queryByLabelText(/parent epic/i)).not.toBeInTheDocument();
  });

  it("will not submit a feature without an epic", async () => {
    let calls = 0;
    server.use(http.post("/api/work-items", async () => {
      calls += 1;
      return created(workItem);
    }));
    show();

    await userEvent.type(screen.getByLabelText(/title/i), "Ship it");
    await userEvent.click(screen.getByRole("radio", { name: "Feature" }));
    await userEvent.click(screen.getByRole("button", { name: /create work item/i }));

    expect(calls).toBe(0);
    expect(await screen.findByText(/a feature needs an epic/i)).toBeInTheDocument();
  });

  it("sends the project and type the API expects", async () => {
    const bodies: unknown[] = [];
    server.use(http.post("/api/work-items", async ({ request }) => {
      bodies.push(await request.json());
      return created(workItem);
    }));
    show();

    await userEvent.type(screen.getByLabelText(/title/i), "Ship it");
    await userEvent.click(screen.getByRole("button", { name: /create work item/i }));

    expect(bodies).toEqual([{ project_id: "p1", type: "task", title: "Ship it" }]);
  });

  it("carries the epic through when a task sits under a feature", async () => {
    // A task under a feature must also carry its epic — the API enforces it.
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.get("/api/work-items", () =>
        okList([
          { ...workItem, id: "e1", type: "epic", title: "Get roster running" },
          { ...workItem, id: "f1", type: "feature", title: "Memory summary" },
        ])),
      http.post("/api/work-items", async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return created(workItem);
      }),
    );
    show();
    await screen.findByLabelText(/parent epic/i);

    await userEvent.type(screen.getByLabelText(/title/i), "Ship it");
    await userEvent.selectOptions(screen.getByLabelText(/parent epic/i), "e1");
    await userEvent.selectOptions(screen.getByLabelText(/parent feature/i), "f1");
    await userEvent.click(screen.getByRole("button", { name: /create work item/i }));

    expect(bodies[0]).toMatchObject({ epic_id: "e1", feature_id: "f1" });
  });
});
