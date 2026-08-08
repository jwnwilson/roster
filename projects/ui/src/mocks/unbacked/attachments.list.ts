/** No `Attachment` persistence. Shaped as the eventual API would return it.
 *
 * `origin` matters: the design distinguishes what the operator uploaded from what
 * an agent produced, and that distinction is the point of the screen — agents
 * write into `.roster/artifacts`, and this is where you see what they left. */
export type Attachment = {
  id: string;
  filename: string;
  bytes: number;
  origin: "uploaded" | "agent_output";
  author: string;
  created_at: string;
};

export const attachments: Attachment[] = [
  {
    id: "f1", filename: "summary.md", bytes: 4_820,
    origin: "agent_output", author: "atlas", created_at: "2026-08-02T09:05:00Z",
  },
  {
    id: "f2", filename: "architecture.png", bytes: 1_204_990,
    origin: "uploaded", author: "you", created_at: "2026-08-01T14:00:00Z",
  },
];

export const formatBytes = (bytes: number): string =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.round(bytes / 1000)} KB`;
