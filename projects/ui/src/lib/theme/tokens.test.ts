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

describe("design tokens — scales from the handoff", () => {
  it("defines the type scale the handoff specifies", () => {
    for (const token of [
      "--text-size-9", "--text-size-9-5", "--text-size-10", "--text-size-10-5",
      "--text-size-11", "--text-size-11-5", "--text-size-12", "--text-size-12-5",
      "--text-size-13", "--text-size-13-5", "--text-size-15", "--text-size-17",
    ]) {
      expect(css, `${token} is missing`).toContain(token);
    }
  });

  it("defines every radius the handoff uses", () => {
    for (const radius of ["--radius-3", "--radius-4", "--radius-5", "--radius-6",
                          "--radius-7", "--radius-8", "--radius-9"]) {
      expect(css, `${radius} is missing`).toContain(radius);
    }
  });

  it("defines the spacing steps the handoff uses", () => {
    for (const step of ["--space-4", "--space-9", "--space-11", "--space-13",
                        "--space-14", "--space-20", "--space-24"]) {
      expect(css, `${step} is missing`).toContain(step);
    }
  });

  it("defines the frame shadow", () => {
    expect(css).toMatch(/--shadow-frame:\s*0 8px 32px rgba\(0,\s*0,\s*0,\s*0?\.60\)/);
  });

  it("maps the scales into the Tailwind theme so utilities generate", () => {
    // Values under :root are inert until @theme inline picks them up — a token
    // defined but unmapped silently produces no utility at all.
    for (const mapped of ["--text-11-5", "--radius-7", "--spacing-13", "--shadow-frame"]) {
      expect(css, `${mapped} is not mapped into @theme`).toContain(mapped);
    }
  });
});
