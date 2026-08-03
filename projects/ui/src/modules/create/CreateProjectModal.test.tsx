import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { describe, expect, it, vi } from "vitest";

import { CreateProjectModal } from "./CreateProjectModal";
import { created, failure } from "../../mocks/envelope";
import { project } from "../../mocks/fixtures";
import { server } from "../../mocks/server";
import { renderWithProviders } from "../../test/renderWithProviders";

const show = (onClose = vi.fn()) =>
  renderWithProviders(<CreateProjectModal onClose={onClose} />);

describe("CreateProjectModal", () => {
  it("offers the three project types from the design", () => {
    show();

    for (const label of ["Git repository", "Local folder", "No code"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("hides the source field entirely for a no-code project", async () => {
    show();

    await userEvent.click(screen.getByRole("radio", { name: "No code" }));

    expect(screen.queryByLabelText(/repository url|local path/i)).not.toBeInTheDocument();
  });

  it("submits the declared source shape the API expects", async () => {
    const bodies: unknown[] = [];
    server.use(http.post("/api/projects", async ({ request }) => {
      bodies.push(await request.json());
      return created(project);
    }));
    show();

    await userEvent.type(screen.getByLabelText(/name/i), "research");
    await userEvent.click(screen.getByRole("radio", { name: "No code" }));
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));

    expect(bodies).toEqual([{ name: "research", source: { kind: "none" } }]);
  });

  it("sends the url only for a git project", async () => {
    const bodies: unknown[] = [];
    server.use(http.post("/api/projects", async ({ request }) => {
      bodies.push(await request.json());
      return created(project);
    }));
    show();

    await userEvent.type(screen.getByLabelText(/name/i), "api-service");
    await userEvent.type(screen.getByLabelText(/repository url/i), "git@github.com:acme/api.git");
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));

    expect(bodies).toEqual([
      { name: "api-service", source: { kind: "git", url: "git@github.com:acme/api.git" } },
    ]);
  });

  it("does not offer an artifact store choice", () => {
    // Deliberate deviation from the handoff: the location is fixed at
    // <project folder>/.roster/artifacts, so there is nothing to choose (spec §6).
    show();

    expect(screen.queryByText(/artifact store/i)).not.toBeInTheDocument();
  });

  it("renders a validation error against the offending field, not as a bare toast", async () => {
    server.use(http.post("/api/projects", () => failure(422, "name: must not be empty")));
    show();

    await userEvent.type(screen.getByLabelText(/name/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));

    expect(await screen.findByText(/must not be empty/i)).toBeInTheDocument();
  });

  it("does not create two projects when submit is pressed twice", async () => {
    let calls = 0;
    server.use(http.post("/api/projects", async () => {
      calls += 1;
      return created(project);
    }));
    show();

    await userEvent.type(screen.getByLabelText(/name/i), "api-service");
    const submit = screen.getByRole("button", { name: /create project/i });
    await userEvent.click(submit);
    await userEvent.click(submit);

    expect(calls).toBe(1);
  });

  it("closes once the project exists", async () => {
    const onClose = vi.fn();
    show(onClose);

    await userEvent.type(screen.getByLabelText(/name/i), "api-service");
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("CreateProjectModal — retry", () => {
  it("can be submitted again after a failure", async () => {
    let calls = 0;
    server.use(http.post("/api/projects", async () => {
      calls += 1;
      return calls === 1 ? failure(422, "name: must not be empty") : created(project);
    }));
    show();

    await userEvent.type(screen.getByLabelText(/name/i), "api-service");
    const submit = screen.getByRole("button", { name: /create project/i });
    await userEvent.click(submit);
    await screen.findByText(/must not be empty/i);
    await userEvent.click(submit);

    expect(calls).toBe(2);
  });
});
