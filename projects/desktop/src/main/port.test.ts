import net from "node:net";
import { describe, expect, it } from "vitest";

import { findFreePort } from "./port";

describe("findFreePort", () => {
  it("returns a port in the ephemeral range", async () => {
    // Act
    const port = await findFreePort();

    // Assert
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThanOrEqual(65535);
  });

  it("releases the port so the server can actually bind it", async () => {
    // The whole point: we ask the OS for a port, then hand it to uvicorn. If the
    // probe socket were still open, uvicorn would fail to bind.
    // Arrange
    const port = await findFreePort();

    // Act
    const bound = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });

    // Assert
    expect(bound).toBe(true);
  });
});
