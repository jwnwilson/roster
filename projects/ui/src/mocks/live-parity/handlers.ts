import { http } from "msw";

import { agent, brokenAgent, infraProject, leadThread, messages, project, thread, workItem }
  from "../fixtures";
import { created, ok, okList } from "../envelope";

/** Handlers that mirror an endpoint the backend actually implements.
 *
 * These exist so the app runs with no backend (`VITE_USE_MOCKS=true`), not to
 * stand in for something missing. Anything without a real endpoint belongs in
 * `../unbacked/` and must be registered in the capability registry. */
export const liveParityHandlers = [
  http.get("/api/projects", () => okList([project, infraProject])),
  http.get("/api/projects/:id", () => ok(project)),
  http.post("/api/projects", async ({ request }) =>
    created({ ...project, ...(await request.json() as object), id: "p-new" })),
  http.delete("/api/projects/:id", () => new Response(null, { status: 204 })),

  http.get("/api/work-items", () => okList([workItem])),
  http.post("/api/work-items", async ({ request }) =>
    created({ ...workItem, ...(await request.json() as object), id: "w-new", key: "ROS-9" })),
  http.patch("/api/work-items/:id", async ({ request }) =>
    ok({ ...workItem, ...(await request.json() as object) })),

  http.get("/api/agents", () => okList([agent, brokenAgent])),

  http.get("/api/threads", () => okList([leadThread, thread])),
  http.get("/api/threads/:id", () => ok(thread)),
  http.post("/api/threads", async ({ request }) =>
    created({ ...thread, ...(await request.json() as object), id: "t-new" })),
  http.patch("/api/threads/:id", async ({ request }) =>
    ok({ ...thread, ...(await request.json() as object) })),
  http.get("/api/threads/:id/messages", () => okList(messages)),
  http.post("/api/threads/:id/messages", async ({ request }) =>
    created({ ...messages[0], ...(await request.json() as object), id: "m-new" })),
  http.post("/api/threads/mark-all-read", () => ok({ marked: 2 })),
];
