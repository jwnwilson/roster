import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("exposes switch semantics and toggles on click", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(<Toggle checked={false} onChange={onChange} />);
    const sw = getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
