import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageList } from "./MessageList";
import { messages } from "../../mocks/fixtures";

describe("MessageList", () => {
  it("says a conversation is empty rather than rendering nothing", () => {
    // An empty <ol> is indistinguishable from a list that failed to load.
    render(<MessageList messages={[]} />);

    expect(screen.getByText(/nothing has been said yet/i)).toBeInTheDocument();
  });

  it("renders each message under a testid naming its kind", () => {
    render(<MessageList messages={messages} />);

    expect(screen.getByTestId("message-file_write")).toBeInTheDocument();
    expect(screen.getByTestId("message-question")).toBeInTheDocument();
  });

  it("labels a file write and a question so they do not read as prose", () => {
    render(<MessageList messages={messages} />);

    expect(screen.getByText("WROTE")).toBeInTheDocument();
    expect(screen.getByText("ASKS")).toBeInTheDocument();
  });
});
