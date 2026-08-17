import net from "node:net";

/**
 * Ask the OS for a free port and release it.
 *
 * There is a race between releasing and uvicorn binding. It is small, and the
 * alternative — parsing the chosen port out of uvicorn's log line — is a
 * fragile contract with a log format. The supervisor retries instead.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("the OS did not report a bound port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
