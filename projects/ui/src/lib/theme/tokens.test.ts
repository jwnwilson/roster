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

describe("accessibility rules", () => {
  /** The selector list of the :focus-visible rule, comments stripped.
   *
   *  Extracted rather than substring-matched against the whole file. The first
   *  version of this test asserted `css.toContain("button")`, which kept passing
   *  after `button` was deleted from the rule — the word survived in the comment
   *  above it. A test that cannot detect the regression it names is worse than no
   *  test, so this one is mutation-checked both ways.
   */
  const focusRule = (): { selector: string; body: string } => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const match = withoutComments.match(/([^;{}]*):focus-visible\s*\{([^}]*)\}/);
    if (!match) throw new Error("there is no :focus-visible rule at all");
    return { selector: match[1], body: match[2] };
  };

  it("covers every interactive element with the focus rule", () => {
    // F1: 30 of 33 primitives had no focus style — the whole keyboard path.
    const { selector } = focusRule();

    for (const element of [
      "button", "a", 'role="tab"', 'role="switch"', "select", "input", "textarea",
    ]) {
      expect(selector, `${element} is not in the :focus-visible selector`).toContain(element);
    }
  });

  it("draws something visible, not merely a rule that exists", () => {
    const { body } = focusRule();

    // `outline: 0px` and `outline: 2px solid transparent` both remove the ring
    // while matching a naive /outline:\s*\d/ — the first version of this test
    // admitted exactly the case its name forbids.
    const width = body.match(/outline:\s*(\d+(?:\.\d+)?)px/);
    expect(width, "no pixel outline width").not.toBeNull();
    expect(Number(width![1])).toBeGreaterThan(0);
    expect(body).not.toMatch(/outline:[^;]*transparent/);
    expect(body).toMatch(/outline-offset:/);
  });

  it("uses focus-visible rather than focus", () => {
    // A mouse click should not leave a ring behind.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

    expect(withoutComments).not.toMatch(/[^-]:focus\s*\{/);
  });

  it("stands down animation when the operating system asks it to", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toMatch(/animation-iteration-count:\s*1\s*!important/);
  });
});

describe("no colour literals outside the theme", () => {
  it("keeps every hex and rgba value in tokens.css", async () => {
    // Spec §6: "a hardcoded hex in a component is a defect". A literal cannot be
    // changed by changing a token, so the theme silently stops being the source
    // of truth. This asserts it rather than trusting review to catch each one.
    const { globSync } = await import("node:fs");
    // .ts as well as .tsx: a literal in an API module or a fixture is the same
    // defect, and the first version of this test scanned only components.
    const files = globSync("src/**/*.{ts,tsx}", { cwd: resolve(__dirname, "../../..") });
    const offenders: string[] = [];

    // Any hex length — #fff and #0e0f11ff both slipped past a {6} match, and
    // #fff is the form someone reaches for first.
    const literal = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

    for (const file of files) {
      // Tests may legitimately name a colour (this file's own regex does).
      // Only shipped UI is in scope.
      if (file.includes("theme/") || /\.test\.tsx?$/.test(file)) continue;
      const source = readFileSync(resolve(__dirname, "../../..", file), "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        if (literal.test(line)) offenders.push(`${file}:${index + 1}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("the canvas is the visual authority", () => {
  it("has a token for every colour, size and radius the hi-fi canvas uses", () => {
    // The README documents a subset of what the canvas actually uses, and
    // building from the README alone could not reach the design. This diffs
    // against the canvas itself so the gap cannot silently reopen.
    const canvas = readFileSync(
      resolve(__dirname, "../../../../../docs/design/Roster Hi-Fi.dc.html"),
      "utf8",
    );
    const nums = (source: string, pattern: RegExp) =>
      new Set([...source.matchAll(pattern)].map((m) => m[1].replace("-", ".")));

    const canvasColours = new Set(
      [...canvas.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => m[1].toLowerCase()),
    );
    const mine = new Set([...css.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => m[1].toLowerCase()));
    // #2563eb is a stray browser default, deliberately untokenised.
    const missingColours = [...canvasColours].filter((c) => !mine.has(c) && c !== "2563eb");

    const missingSizes = [...nums(canvas, /font-size:\s*([\d.]+)px/g)].filter(
      (s) => !nums(css, /--text-size-([\d-]+):/g).has(s),
    );
    const missingRadii = [...nums(canvas, /border-radius:\s*([\d.]+)px/g)].filter(
      (r) => !nums(css, /--radius-([\d-]+):/g).has(r),
    );

    expect({ missingColours, missingSizes, missingRadii }).toEqual({
      missingColours: [], missingSizes: [], missingRadii: [],
    });
  });
});
