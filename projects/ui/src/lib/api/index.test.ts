import { describe, expect, it } from "vitest";

import * as api from "./index";

describe("api barrel", () => {
  it("re-exports the envelope client and the query wiring", () => {
    for (const name of ["apiFetch", "apiList", "apiPost", "apiPatch", "apiDelete", "queryKeys"]) {
      expect(api[name as keyof typeof api], `${name} is not exported`).toBeDefined();
    }
  });

  it("exports no hooks yet", () => {
    // Task 3 rebuilds lib/api against roster's own endpoints. The inherited
    // hooks were typed against a generated schema for a different API and were
    // deleted rather than stubbed — this asserts none crept back in.
    const hooks = Object.keys(api).filter((name) => name.startsWith("use"));

    expect(hooks).toEqual([]);
  });
});
