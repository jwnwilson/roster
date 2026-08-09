import { http } from "msw";

import { agent, brokenAgent, infraProject, leadMessages, leadThread, messages, project, thread, workItem }
  from "../fixtures";
import { created, ok, okList } from "../envelope";

/** Handlers that mirror an endpoint the backend actually implements.
 *
 * These exist so the app runs with no backend (`VITE_USE_MOCKS=true`), not to
 * stand in for something missing. Anything without a real endpoint belongs in
 * `../unbacked/` and must be registered in the capability registry. */
export const liveParityHandlers = [
  http.get("/api/projects", () => okList([project, infraProject])),
  http.get("/api/projects/:id", ({ params }) =>
    params.id === infraProject.id ? ok(infraProject) : ok(project)),
  http.post("/api/projects", async ({ request }) =>
    created({ ...project, ...(await request.json() as object), id: "p-new" })),
  http.delete("/api/projects/:id", () => new Response(null, { status: 204 })),

  // Honours project_id. Ignoring it let a test pass whichever project it asked
  // for, which is how the Thread tab shipped showing the wrong conversation.
  http.get("/api/work-items", ({ request }) => {
    const projectId = new URL(request.url).searchParams.get("project_id");
    return okList([workItem].filter((item) => !projectId || item.project_id === projectId));
  }),
  http.post("/api/work-items", async ({ request }) =>
    created({ ...workItem, ...(await request.json() as object), id: "w-new", key: "ROS-9" })),
  http.patch("/api/work-items/:id", async ({ request }) =>
    ok({ ...workItem, ...(await request.json() as object) })),

  http.get("/api/agents", () => okList([agent, brokenAgent])),

  // Honours the filters the real endpoint supports. Without this the work-item
  // Thread tab took results[0] — the *lead* thread — and its test could not
  // notice, because every thread id returned the same messages.
  http.get("/api/threads", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const workItemId = params.get("work_item_id");
    const projectId = params.get("project_id");
    const status = params.get("status");
    return okList(
      [leadThread, thread].filter(
        (candidate) =>
          (!workItemId || candidate.work_item_id === workItemId) &&
          (!projectId || candidate.project_id === projectId) &&
          (!status || candidate.status === status),
      ),
    );
  }),
  http.get("/api/threads/:id", ({ params }) =>
    params.id === leadThread.id ? ok(leadThread) : ok(thread)),
  http.post("/api/threads", async ({ request }) =>
    created({ ...thread, ...(await request.json() as object), id: "t-new" })),
  http.patch("/api/threads/:id", async ({ request }) =>
    ok({ ...thread, ...(await request.json() as object) })),
  // Distinct per thread, so a screen reading the wrong one is visible in a test
  // rather than silently identical.
  http.get("/api/threads/:id/messages", ({ params }) =>
    okList(params.id === leadThread.id ? leadMessages : messages)),
  http.post("/api/threads/:id/messages", async ({ request }) =>
    created({ ...messages[0], ...(await request.json() as object), id: "m-new" })),
  http.post("/api/threads/mark-all-read", () => ok({ marked: 2 })),
];
