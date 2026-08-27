# Initial prompt for Claude Code

Paste this in to kick off the build:

---

I'm building Roster, a desktop app for managing a roster of AI coding agents (each with a provider/model, working directory, skills, and MCP servers), chatting with them, watching their terminals, approving risky actions, and letting agents hand off sessions to each other. It also has a shared Linear-style Tasks kanban board (grouped by project) that agents and humans both use to pick up and track work.

I have a full design handoff in `design_handoff_roster/`:
- `README.md` — screens, layout, design tokens (colors, type, spacing), interactions, and state shape
- `Roster.dc.html` — a high-fidelity HTML/CSS/JS prototype of every screen (read this for exact structure/values; it's a design reference, not code to reuse as-is)
- `screenshots/` — reference captures of a few screens

Read the README and the prototype first, then set up the project and build it.

**Suggested stack** (swap anything if you have a better fit or an existing convention to follow):
- **Shell**: Tauri (small binary, uses the system webview, easy access to real ptys/filesystem via Rust) or Electron if you'd rather stay all-JS/TS. Either works — this is a multi-pane desktop app, not a web page.
- **UI**: React + TypeScript, Vite for dev/build.
- **Styling**: Tailwind CSS, configured with the exact color/spacing/type tokens from the README's Design Tokens section (don't invent new values — pull the palette and scale into `tailwind.config`).
- **State**: Zustand (or React context if you prefer fewer deps) for the app-level state described in the README's State Management section — screen, active agent/session, per-agent overrides, edit-modal draft, etc.
- **Terminal rendering**: `xterm.js` wired to a real pty (`node-pty` under Electron, or a Rust pty crate + Tauri command) instead of the prototype's static line list.
- **Chat/message list**: [assistant-ui](https://github.com/assistant-ui/assistant-ui) for the chat pane (message list, streaming, tool-call rendering) — it already covers most of the prototype's message kinds (text, tool call, streaming indicator); style it to match the tokens rather than its defaults. Fall back to a plain virtualized list (`@tanstack/react-virtual`) if it doesn't fit the spawn/handoff message types.
- **Agent process/config**: model this from the start as real data — agent configs as `agent.toml` files on disk (per the "Edit" modal's footer note in the prototype), sessions and messages persisted (SQLite via `better-sqlite3` or similar) rather than hardcoded demo arrays.
- **LLM calls**: Anthropic/OpenAI/Google SDKs behind a small provider-agnostic interface, since agents can be configured with any of the three.

**Build order I'd suggest:**
1. Scaffold the shell (Tauri/Electron + React + Tailwind) with the sidebar + routing between the 5 screens, static first.
2. Wire real state management and the Agents Grid against a small in-memory/mock data layer matching the README's data model.
3. Build Agent Detail (chat pane first, then terminal via xterm.js + real pty, then the config rail and edit modal).
4. Build the Tasks board (kanban columns, task detail modal with Markdown description + Comments/History tabs, Projects CRUD modal) against the same data layer.
5. Build Skills and MCP Servers screens against real filesystem/config reads.
6. Wire actual model calls so chat is live, then approval-gating for risky tool calls, then let agents create/update/comment on tasks as part of their tool loop.

Ask me before introducing any dependency not listed above, and before deviating from the visual spec in the README.
