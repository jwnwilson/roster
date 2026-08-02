import { http } from "msw";

import { ok } from "../envelope";

/** No entity carries a token, spend or progress field — see `tokens.usage` in the
 *  capability registry. Every figure below is invented so the design's layout can
 *  be settled; none of it means anything. */
export const tokenUsage = {
  budget_used: 412_000,
  budget_limit: 1_000_000,
  today: [120, 340, 280, 410, 260, 500, 380],
};

export const tokensUsageHandlers = [
  http.get("/api/_unbacked/tokens", () => ok(tokenUsage)),
];
