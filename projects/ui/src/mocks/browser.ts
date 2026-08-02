import { setupWorker } from "msw/browser";

import { liveParityHandlers } from "./live-parity/handlers";
import { tokensUsageHandlers } from "./unbacked/tokens.usage";

export const worker = setupWorker(...liveParityHandlers, ...tokensUsageHandlers);
