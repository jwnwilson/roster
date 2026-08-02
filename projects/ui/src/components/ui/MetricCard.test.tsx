import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricCard } from "./MetricCard";

describe("MetricCard", () => {
  it("shows label, value and sub-text", () => {
    render(<MetricCard label="ACTIVE AGENTS" value="4" sub="3 running" />);
    expect(screen.getByText("ACTIVE AGENTS")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("3 running")).toBeInTheDocument();
  });
});
