import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "tokens.css"), "utf8");

describe("design tokens", () => {
  it("defines the core background, text, accent, and border tokens", () => {
    for (const token of [
      "--bg-base", "--bg-sidebar", "--bg-surface",
      "--text-1", "--text-4", "--text-7",
      "--accent", "--accent-bg", "--border", "--border-strong",
      "--green", "--red-text", "--yellow-text", "--blue-text",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("uses the exact accent violet from the handoff", () => {
    expect(css).toMatch(/--accent:\s*#7c6cf0/);
  });

  it("defines the pulse keyframes", () => {
    expect(css).toContain("@keyframes pulse");
  });
});
