import { useEffect, useState } from "react";
import type { McpServer } from "@shared/types";
import type { NotionAuthStatus } from "@shared/notion";
import { Field, Modal, TextInput } from "@/components/primitives";
import { ServerGlyph } from "@/components/ServerGlyph";

/** A row in the editor; kept as a list so a half-typed key does not vanish. */
interface EnvRow {
  key: string;
  value: string;
}

export interface McpServerDraft {
  name: string;
  command: string;
  /** True when this came from the registry and is not configured yet. */
  installing: boolean;
}

interface McpServerModalProps {
  draft: McpServerDraft;
  /** The configured server, when there is one to read the environment from. */
  existing: McpServer | null;
  onClose: () => void;
  onSaved: (servers: McpServer[]) => void;
}

function rowsFrom(env: Record<string, string>): EnvRow[] {
  return Object.entries(env).map(([key, value]) => ({ key, value }));
}

/** Later rows win, and blank keys are dropped rather than written as "". */
function envFrom(rows: readonly EnvRow[]): Record<string, string> {
  return Object.fromEntries(
    rows
      .filter((row) => row.key.trim() !== "")
      .map((row) => [row.key.trim(), row.value]),
  );
}

/**
 * Configures one MCP server: how to launch it, and the environment it needs.
 *
 * Reached by clicking a card in either tab. A registry entry opens the same
 * editor pre-filled, so its command and token can be set before it is
 * installed rather than after it has already failed to start once.
 */
export function McpServerModal({
  draft,
  existing,
  onClose,
  onSaved,
}: McpServerModalProps) {
  const [command, setCommand] = useState(draft.command);
  const [rows, setRows] = useState<EnvRow[]>(rowsFrom(existing?.env ?? {}));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = command.trim();

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      // Install first when it is new: save refuses a name it does not know.
      if (draft.installing)
        await window.roster.mcp.install(draft.name, trimmed);
      onSaved(await window.roster.mcp.save(draft.name, trimmed, envFrom(rows)));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  function patchRow(index: number, patch: Partial<EnvRow>): void {
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <Modal
      label={`Configure ${draft.name}`}
      onClose={onClose}
      header={
        <>
          <ServerGlyph name={draft.name} />
          <h2 className="m-0 text-2xl font-semibold">{draft.name}</h2>
          <span className="truncate font-mono text-sm text-dim-2">
            mcp.json
          </span>
        </>
      }
      footer={
        <>
          <span className="text-sm text-faint">
            Enable it per agent from the installed list.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto cursor-pointer rounded-pill border border-line-card bg-transparent px-[13px] py-[7px] font-ui text-lg text-ink-3 hover:border-line-hover-strong"
            data-hoverable
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || trimmed === ""}
            className="cursor-pointer rounded-pill border-0 bg-accent px-[15px] py-[7px] font-ui text-lg font-semibold text-white hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
          >
            {saving ? "Saving…" : draft.installing ? "Install" : "Save changes"}
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-[20px] overflow-y-auto p-[18px]">
        {draft.name === "notion" ? <NotionImportAuthentication /> : null}
        <Field
          label="Launch command"
          caption="Run as-is. The first word is the executable; the rest are its arguments."
        >
          <TextInput
            ariaLabel="Launch command"
            value={command}
            onChange={setCommand}
            placeholder="npx @modelcontextprotocol/server-example"
            className="font-mono"
          />
        </Field>

        <Field
          label="Environment"
          caption={
            draft.name === "notion"
              ? "Notion signs in through your browser when the server first starts; do not add a token here."
              : "Stored as plain text in mcp.json. Treat it like any other dotfile with tokens in it."
          }
          trailing={
            <button
              type="button"
              onClick={() => setRows([...rows, { key: "", value: "" }])}
              className="cursor-pointer border-0 bg-transparent p-0 font-ui text-sm text-accent-light"
            >
              Add variable
            </button>
          }
        >
          {rows.length === 0 ? (
            <p className="m-0 text-md text-dim">
              No variables. Most servers need at least a token or a connection
              string.
            </p>
          ) : (
            <div className="flex flex-col gap-[7px]">
              {rows.map((row, index) => (
                <div key={index} className="flex items-center gap-[7px]">
                  <TextInput
                    ariaLabel={`Variable ${index + 1} name`}
                    value={row.key}
                    onChange={(key) => patchRow(index, { key })}
                    placeholder="GITHUB_PERSONAL_ACCESS_TOKEN"
                    className="w-[52%] font-mono text-sm"
                  />
                  <TextInput
                    ariaLabel={`Variable ${index + 1} value`}
                    value={row.value}
                    onChange={(value) => patchRow(index, { value })}
                    placeholder="value"
                    className="min-w-0 flex-1 font-mono text-sm"
                  />
                  <button
                    type="button"
                    aria-label={`Remove variable ${index + 1}`}
                    onClick={() => setRows(rows.filter((_, i) => i !== index))}
                    className="flex-none cursor-pointer border-0 bg-transparent p-0 font-ui text-[15px] leading-none text-dim hover:text-error"
                    data-hoverable
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </Field>

        {error ? <p className="m-0 text-md text-error">{error}</p> : null}
      </div>
    </Modal>
  );
}

/**
 * Import access belongs to the MCP-management flow so a person can connect
 * and import before any agent session exists. Its OAuth grant stays in the
 * main process; it is intentionally not added to the server environment.
 */
function NotionImportAuthentication() {
  const [status, setStatus] = useState<NotionAuthStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.roster.notion.authStatus().then(setStatus).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [])

  async function connect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.roster.notion.beginAuth()
      const poll = async (): Promise<void> => {
        const next = await window.roster.notion.authStatus()
        setStatus(next)
        if (next.state === "disconnected") window.setTimeout(() => void poll(), 750)
        else setBusy(false)
      }
      void poll()
    } catch (cause) {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.roster.notion.clearAuth()
      setStatus({ state: "disconnected" })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const connected = status?.state === "connected"
  const label = connected
    ? `Connected for task import${status.workspaceName ? `: ${status.workspaceName}` : "."}`
    : "Not connected for task import."

  return (
    <section className="rounded-[9px] border border-line bg-card p-[13px]">
      <p className="m-0 font-ui text-lg font-semibold">Task import access</p>
      <p className="mt-[5px] text-md text-dim">{label}</p>
      <p className="mt-[5px] text-md text-dim">
        Connect here to inspect and import Notion tasks without starting an agent session.
      </p>
      <div className="mt-[10px] flex gap-[8px]">
        <button
          type="button"
          onClick={() => void connect()}
          disabled={busy}
          className="cursor-pointer rounded-chip border border-line-active bg-transparent px-[10px] py-[3px] font-ui text-base font-medium text-accent-text hover:border-accent disabled:cursor-default disabled:opacity-40"
        >
          {busy ? "Waiting for Notion…" : connected ? "Reconnect Notion" : "Connect Notion"}
        </button>
        {connected ? (
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="cursor-pointer border-0 bg-transparent p-0 font-ui text-sm text-dim hover:text-ink disabled:cursor-default disabled:opacity-40"
          >
            Disconnect
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-[8px] text-md text-error">{error}</p> : null}
    </section>
  )
}
