import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./app/App";

async function enableMocks() {
  if (import.meta.env.VITE_USE_MOCKS !== "true") return;
  // Task 3 rebuilds the mock layer against roster's own endpoints and restores
  // this import. Until then the app runs unmocked rather than against a worker
  // that would answer for a different API.
}

enableMocks().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
