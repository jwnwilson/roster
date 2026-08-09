import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { TextInput } from "./TextInput";
import { Textarea } from "./Textarea";
import { Select } from "./Select";

test("TextInput forwards value and change", async () => {
  const onChange = vi.fn();
  render(<TextInput aria-label="n" value="" onChange={onChange} />);
  await userEvent.type(screen.getByLabelText("n"), "a");
  expect(onChange).toHaveBeenCalled();
});

test("Textarea renders", () => {
  render(<Textarea aria-label="spec" value="" onChange={() => {}} />);
  expect(screen.getByLabelText("spec")).toBeInTheDocument();
});

test("Select renders options and forwards change", async () => {
  const onChange = vi.fn();
  render(
    <Select aria-label="priority" value="low" onChange={onChange}>
      <option value="low">Low</option>
      <option value="high">High</option>
    </Select>,
  );
  await userEvent.selectOptions(screen.getByLabelText("priority"), "high");
  expect(onChange).toHaveBeenCalled();
});
