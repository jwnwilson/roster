import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("shows the initials", () => {
    render(<Avatar initials="JW" />);
    expect(screen.getByText("JW")).toBeInTheDocument();
  });
  it("uses a rounded square for the agent variant and a circle for user", () => {
    const { container: agent } = render(<Avatar initials="BU" variant="agent" />);
    const { container: user } = render(<Avatar initials="JW" variant="user" />);
    expect((agent.firstChild as HTMLElement).className).not.toContain("rounded-full");
    expect((user.firstChild as HTMLElement).className).toContain("rounded-full");
  });
});
