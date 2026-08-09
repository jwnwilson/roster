import { describe, expect, it } from "vitest";

import { reconnectDelay } from "./reconnect";

describe("reconnectDelay", () => {
  it("starts at the base delay rather than retrying immediately", () => {
    // A tight loop against a failing server is worse than waiting.
    expect(reconnectDelay(0)).toBe(1000);
  });

  it("doubles with each attempt", () => {
    expect([1, 2, 3].map((n) => reconnectDelay(n))).toEqual([2000, 4000, 8000]);
  });

  it("caps so a long outage does not back off to hours", () => {
    expect(reconnectDelay(20)).toBe(15000);
  });
});
