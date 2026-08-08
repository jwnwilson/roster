import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("exposes switch semantics and toggles on click", async () => {
    const onChange = vi.fn();
    const { getByRole } = render(<Toggle checked={false} onChange={onChange} label="Notifications" />);
    const sw = getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

it("carries an accessible name so a screen reader can identify it", () => {
  const { getByRole } = render(
    <Toggle checked onChange={() => {}} label="Enable search_code" />,
  );

  expect(getByRole("switch", { name: "Enable search_code" })).toBeInTheDocument();
});
