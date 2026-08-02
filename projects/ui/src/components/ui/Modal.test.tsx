import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Modal } from "./Modal";

test("renders title and children", () => {
  render(<Modal title="Create Project" onClose={() => {}}>body</Modal>);
  expect(screen.getByRole("dialog")).toHaveTextContent("Create Project");
  expect(screen.getByText("body")).toBeInTheDocument();
});

test("closes on Escape", async () => {
  const onClose = vi.fn();
  render(<Modal title="T" onClose={onClose}>b</Modal>);
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
});

test("closes on overlay click but not panel click", async () => {
  const onClose = vi.fn();
  render(<Modal title="T" onClose={onClose}>b</Modal>);
  await userEvent.click(screen.getByTestId("modal-overlay"));
  expect(onClose).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("dialog"));
  expect(onClose).toHaveBeenCalledOnce(); // unchanged
});

test("closes on the header close button", async () => {
  const onClose = vi.fn();
  render(<Modal title="T" onClose={onClose}>b</Modal>);
  await userEvent.click(screen.getByRole("button", { name: /close/i }));
  expect(onClose).toHaveBeenCalledOnce();
});

test("focuses the panel on open", () => {
  render(<Modal title="T" onClose={() => {}}>b</Modal>);
  expect(screen.getByRole("dialog")).toHaveFocus();
});

test("does not steal focus from an autofocused child", () => {
  render(<Modal title="T" onClose={() => {}}><input aria-label="field" autoFocus /></Modal>);
  expect(screen.getByLabelText("field")).toHaveFocus();
});
