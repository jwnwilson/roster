import { setupServer } from "msw/node";

import { liveParityHandlers } from "./live-parity/handlers";
import { tokensUsageHandlers } from "./unbacked/tokens.usage";

export const server = setupServer(...liveParityHandlers, ...tokensUsageHandlers);
