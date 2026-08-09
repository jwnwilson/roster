import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./app/App";

async function enableMocks() {
  // Mock-first is the *default*, not an opt-in (spec §6): the app must run with
  // no backend on a fresh clone. Vite never loads .env.example and .env is
  // gitignored, so keying off "=== true" meant an unset flag ran unmocked —
  // exactly the opposite of what the docs promised. Only an explicit "false"
  // turns mocks off.
  if (import.meta.env.VITE_USE_MOCKS === "false") return;
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}

enableMocks().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
