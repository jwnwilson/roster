import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { configDefaults } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The client prefixes requests with `/api` (the dev-proxy marker); the backend
  // implements the contract paths at root (`/projects`, `/work-items`), so strip
  // `/api` when proxying to it in live mode (VITE_LIVE_API=true).
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    css: true,
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
