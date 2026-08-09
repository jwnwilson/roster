import { describe, expect, it } from "vitest";
import * as ui from "./index";

describe("ui barrel", () => {
  it("re-exports the core primitives and icons", () => {
    for (const name of ["Button", "Chip", "Toggle", "Avatar", "Tag", "StatusBadge",
      "StatusCircle", "PriorityBars", "PulseDot", "ProgressBar", "Card", "MetricCard",
      "TypingIndicator", "PlusIcon"]) {
      expect(ui[name as keyof typeof ui]).toBeTypeOf("function");
    }
  });
});
