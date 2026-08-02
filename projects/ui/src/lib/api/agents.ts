import { apiList } from "./client";
import type { Agent } from "./types";

/** Read-only. There are no agent write endpoints — see `agents.write` in the
 *  capability registry. */
export const listAgents = () => apiList<Agent>("/agents");
