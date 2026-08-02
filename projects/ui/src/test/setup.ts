import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Polyfill localStorage for jsdom environments that stub it without full Storage API
const makeLocalStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
};
Object.defineProperty(globalThis, "localStorage", {
  value: makeLocalStorage(),
  writable: true,
  configurable: true,
});

// MSW's server/db wiring returns in Task 3, which rebuilds the mock layer
// against roster's own endpoints.
afterEach(() => {
  localStorage.clear();
});
