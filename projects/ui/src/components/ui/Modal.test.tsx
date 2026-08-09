import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, test, vi } from "vitest";
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

describe("Modal — keyboard", () => {
  it("names itself with its own heading rather than a duplicated string", () => {
    render(<Modal title="New project" onClose={() => {}}><input aria-label="Name" /></Modal>);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("New project");
    expect(screen.getByRole("heading", { name: "New project" })).toBeInTheDocument();
  });

  it("keeps Tab inside the dialog", async () => {
    // aria-modal="true" promises the rest of the page is inert. Without a trap,
    // Tab walks out into the sidebar behind the overlay.
    render(
      <>
        <button>outside</button>
        <Modal title="New project" onClose={() => {}}>
          <input aria-label="Name" />
        </Modal>
      </>,
    );

    const name = screen.getByLabelText("Name");
    name.focus();
    await userEvent.tab();
    await userEvent.tab();

    expect(screen.getByRole("button", { name: "outside" })).not.toHaveFocus();
  });

  it("hands focus back to whatever opened it", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          {open && (
            <Modal title="New project" onClose={() => setOpen(false)}>
              <input aria-label="Name" />
            </Modal>
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "open" });

    await userEvent.click(opener);
    await userEvent.keyboard("{Escape}");

    // Otherwise focus drops to <body> and a keyboard user restarts at the top.
    expect(opener).toHaveFocus();
  });
});
