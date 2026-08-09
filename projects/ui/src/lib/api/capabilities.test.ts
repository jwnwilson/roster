import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CAPABILITIES, SCREEN_CAPABILITIES, screenProvenance } from "./capabilities";
import type { CapabilityKey } from "./capabilities";

describe("capability registry", () => {
  it("requires a reason for every unbacked capability", () => {
    for (const [key, entry] of Object.entries(CAPABILITIES)) {
      if (entry.status === "unbacked") {
        expect(entry.reason, `${key} is unbacked without a reason`).toBeTruthy();
      }
    }
  });

  it("requires an endpoint for every live capability", () => {
    for (const [key, entry] of Object.entries(CAPABILITIES)) {
      if (entry.status === "live") {
        expect(entry.endpoint, `${key} is live without an endpoint`).toBeTruthy();
      }
    }
  });

  it("keeps every unbacked handler file matched to an unbacked capability", () => {
    // A handler under unbacked/ whose capability is live means the screen
    // regressed to fixtures, or the registry is lying. Both are defects.
    for (const file of readdirSync(join(__dirname, "../../mocks/unbacked"))) {
      const key = file.replace(/\.ts$/, "") as CapabilityKey;
      expect(CAPABILITIES[key], `${file} names no capability`).toBeDefined();
      expect(CAPABILITIES[key].status, `${file} is a fixture for a live capability`)
        .toBe("unbacked");
    }
  });

  it("reports a screen as not fully live when any capability it uses is unbacked", () => {
    const board = screenProvenance("board");

    // Work items and the assigned agent are real; the token figures are not.
    expect(board.live).toBe(false);
    expect(board.unbacked).toEqual(["tokens.usage"]);
  });

  it("reports a fully backed screen as live", () => {
    expect(screenProvenance("threads").live).toBe(true);
  });

  it("names only known capabilities in every screen's list", () => {
    for (const [screen, keys] of Object.entries(SCREEN_CAPABILITIES)) {
      for (const key of keys) {
        expect(CAPABILITIES[key], `${screen} names unknown capability ${key}`).toBeDefined();
      }
    }
  });
});
