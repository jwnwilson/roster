/** No `Secret` persistence, and deliberately **no value field at all**.
 *
 * Spec §12 defers encryption at rest, so nothing here should carry a plaintext
 * secret even as a fixture. Omitting the field entirely — rather than masking a
 * value on screen — means the UI has nothing to leak by accident. */
export type Secret = {
  name: string;
  scope: string;
  last_used_at: string | null;
};

export const secrets: Secret[] = [
  { name: "GITHUB_TOKEN", scope: "github MCP server", last_used_at: "2026-08-02T09:12:00Z" },
  { name: "LINEAR_TOKEN", scope: "linear MCP server", last_used_at: null },
];
