import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./app/App";

async function enableMocks() {
  // Mock-first is the *default*, not an opt-in (spec §6): the app must run with
  // no backend on a fresh clone. Vite never loads .env.example and .env is
  // gitignored, so keying off `=== "true"` meant an unset flag ran unmocked —
  // the opposite of what the docs promised. Only an explicit "false" turns it off.
  if (import.meta.env.VITE_USE_MOCKS === "false") return;
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}

function render() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Render whatever happens. Awaiting mocks without catching meant a service
// worker that could not register — headless browsers, private windows, a
// blocked registration — left the page permanently blank with nothing in the
// UI to say why. Failing to mock is a degraded app; failing to render is no app.
enableMocks()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("mock service worker did not start; continuing unmocked", error);
  })
  .finally(render);
