import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { FormField } from "./FormField";

test("renders label and children", () => {
  render(<FormField label="Name"><input aria-label="Name" /></FormField>);
  expect(screen.getByText("Name")).toBeInTheDocument();
  expect(screen.getByLabelText("Name")).toBeInTheDocument();
});

test("renders error text when provided", () => {
  render(<FormField label="Name" error="Required"><input /></FormField>);
  expect(screen.getByText("Required")).toBeInTheDocument();
});
