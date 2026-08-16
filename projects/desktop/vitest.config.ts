import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/main/**/*.ts"],
      // main.ts is Electron wiring: app.whenReady, BrowserWindow, dialog. It
      // cannot run without a display, so it is kept tiny and excluded rather
      // than faked. Spec §6.4 records this as a known gap.
      exclude: ["src/main/main.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
