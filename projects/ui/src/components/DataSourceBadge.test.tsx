import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DataSourceBadge } from "./DataSourceBadge";

describe("DataSourceBadge", () => {
  it("names how many capabilities are mocked on a partly-mocked screen", () => {
    render(<DataSourceBadge screen="board" />);

    expect(screen.getByTestId("data-source-badge")).toHaveTextContent(/1 mocked/i);
  });

  it("names which capabilities they are", () => {
    render(<DataSourceBadge screen="dashboard" />);

    expect(screen.getByTestId("data-source-badge")).toHaveAttribute(
      "title",
      expect.stringContaining("tokens.usage"),
    );
  });

  it("renders nothing for a fully live screen", () => {
    render(<DataSourceBadge screen="threads" />);

    expect(screen.queryByTestId("data-source-badge")).not.toBeInTheDocument();
  });

  it("renders nothing outside a dev build", () => {
    vi.stubEnv("DEV", false);

    render(<DataSourceBadge screen="board" />);

    expect(screen.queryByTestId("data-source-badge")).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});
