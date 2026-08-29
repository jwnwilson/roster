
# Handoff: Roster — Multi-Agent Harness Platform

## Overview
Roster is a desktop app for managing a roster of AI coding agents. Each agent has a
provider/model, working directory, skills, and MCP servers. Users open agents into
chat or terminal sessions, approve risky actions (e.g. force-push), and agents can
hand off work to one another by spawning sessions on each other.

## About the Design Files
The bundled file (`Roster.dc.html`) is a **design reference** built in HTML/CSS/JS —
a working prototype of look, layout, and interaction, not production code to copy
directly. The task is to **recreate this design in the target codebase's existing
environment** (React, Electron, native desktop, etc.) using its established patterns
and libraries. If no environment exists yet, choose the framework best suited to a
desktop-style multi-pane app (React + Electron/Tauri is a natural fit given the
chrome-window, sidebar, and multi-pane layout) and implement there.

## Fidelity
**High-fidelity.** Colors, spacing, typography, and states below are final values
taken directly from the prototype — recreate pixel-for-pixel using the target
codebase's component library where one exists, else with these exact tokens.

## Global Layout
Full-height app shell, `display:flex`, no page scroll (`height:100vh`, `overflow:hidden`
on outer shell); each screen manages its own internal scrolling.

- **Left sidebar** — 216px fixed width, `#0d0e12` background, 1px `#1e2027` right border.
  - Header (44px): 16×16px rounded-5px purple square logo (`#7c5cff`), "Roster" wordmark
    (600 weight), 3 small 9px window-control dots right-aligned.
  - Nav list: 5 items (Agents, Skills, MCP servers, Tasks, Spend) — all fully
    functional; Tasks' meta shows live task count, Spend's meta shows the running
    total cost. Each row: 5px dot + label (500 weight) + right-aligned meta count,
    6px/8px padding, 6px radius, hover `#1a1c23`, active state bg `#1c1e26` fg
    `#e6e6ea`.
  - "Roster" section label (10.5px uppercase, letter-spacing 0.07em, `#585b67`) + agent
    count (monospace, `#4f5260`).
  - Search input: full width, 6px/9px padding, 1px `#1e2027` border, 6px radius, bg
    `#15161c`; focus border `#3a3050` bg `#171420`.
  - Agent list: each row 6px dot (status color) + name (ellipsis) + session count
    (monospace `#4f5260`), hover bg `#1a1c23`.
  - Footer (pinned bottom, 1px top border): 22×22px rounded-6px avatar chip "JD" +
    "Local workspace" label.

## Screens

### 1. Agents Grid (default screen)
- **Purpose**: overview of all agents as cards; entry point to agent detail.
- **Header** (44px): "Agents" title, live summary text ("5 configured · 1 running" or
  filtered match count), right-aligned project-filter dropdown (styled select, "All
  projects" + one entry per project), filter input (200px), "New agent" button
  (purple `#7c5cff`, white text, 600 weight, 6px radius, hover `#8f74ff`). Picking a
  project narrows both which agent cards show (only agents with a session in that
  project) and which session chips appear within each visible card.
- **Grid**: 2-column CSS grid, `minmax(268px,1fr)` row height, 24px gap, 18px page
  padding, scrolls independently.
- **Agent card** (`#15161c` bg, 1px `#1e2027` border — amber `#4a3a1e` when status is
  "approval", 10px radius):
  - Card header (9px/12px padding, `#131419` bg, 1px bottom border): status dot (7px),
    agent name (600, 12.5px), status label colored by status, right-aligned model id
    (monospace 10.5px `#5f6270`).
  - Session chip row (6px/10px padding, `#101116` bg): pill chips per open session —
    glyph (↳ for agent-opened, • for user-opened), title (ellipsis, max-width 150px),
    trailing status dot; clicking opens that session directly.
  - Transcript preview: last 4 lines, each a `who` label (52px fixed, monospace
    uppercase 10px, colored by role) + message text (12px, `#b9bcc8`), opacity fades
    for older lines (0.45–1.0).
  - Card footer (`#131419` bg, top border, monospace 10.5px `#5f6270`): cwd path,
    token count (right-aligned), cost.
  - Cards with "approval" status pulse via a 2s box-shadow/border animation
    (`rosterPulse`).
- **Status bar** (38px, bottom, `#0d0e12`): "↳ session opened by another agent" note +
  right-aligned current-session tokens/cost readout — decorative footer, static demo
  text in the prototype.

**Status vocabulary** (used everywhere): `running` (purple `#7c5cff`), `approval`
(amber `#d9a04a`, label "needs you"), `done` (green `#4fa86a`, label "finished"),
`idle` (`#4f5260`/`#6d707d`, label "idle"), `error` (`#c2553f`, unused in current data
but defined).

### 2. Agent Detail
- **Purpose**: work inside one agent — chat with it, watch its terminal, manage its
  config, switch between its sessions.
- **Header** (44px): breadcrumb "Agents / ● AgentName  model-id", right-aligned
  Chat/Terminal segmented toggle (2px padding, `#15161c` bg, 1px `#24262f` border,
  active segment bg `#26283a` fg `#e6e6ea`).
- **Session tab strip** (6px/12px padding, `#0f1015` bg, horizontal scroll): one pill
  per session (glyph + title + origin label + status dot, 5px/11px padding, 7px
  radius, active bg `#1c1e26` border `#2e313c`) plus a dashed "+ New session" pill.
- **Approval banner** (conditional, shown when the active session's status is
  "approval"): amber-tinted bar (`#1c1710` bg, `#3a2f18` border) — dot + message
  naming the exact command needing approval (monospace) + Deny/Approve buttons
  (Approve filled amber `#d9a04a`, dark text).
- **Body**: flex row — primary pane (chat or terminal, order/flex driven by a
  `layout` state so either can be primary) + fixed 260px right config rail.
  - **Chat pane**: scrollable message list (22px/26px padding, 20px gap between
    messages, auto-scrolls to bottom on session/mode change). Message kinds:
    - *Text*: role label (uppercase 11px, colored — user `#8f93a3`, agent purple) +
      timestamp (monospace `#4f5260`) + body (13.5px, 1.62 line-height, `#d2d4dd`,
      preserves newlines).
    - *Tool call*: collapsed by default row (chevron + tool name in purple monospace +
      truncated args + duration, `#15161c` bg, 1px `#24262f` border) that expands on
      click to show monospace output (`#101116` bg).
    - *Spawn* (this session was opened by another agent): left border accent
      (`#3a3050`), message text, and a "back to X" pill linking to the originating
      agent/session.
    - *Handoff* (this session opened others): one pill per link, each jumps to the
      target agent+session, with a trailing status dot.
    - *Streaming indicator*: pulsing dot + status text + Stop/Retry buttons (shown
      while `isStreaming` is true for the demo data).
    - Composer (fixed bottom, 12px/26px padding, `#0f1015` bg): bordered box
      (`#15161c` bg, `#262933` border, 9px radius) with an optional attached-file chip,
      a "drop files here" dashed zone, placeholder message line, skills-in-use line
      (monospace), and a purple Send button.
  - **Terminal pane** (alternate mode): dark `#0b0c0f` bg, header showing shell/cwd +
    "agent attached" indicator (green dot) + terminal size (80×24); body is monospace
    12px/1.65 lines with colored prompt glyphs, ending in a live "typed" command line
    with a blinking block cursor.
  - **Config rail** (260px, `#0d0e12` bg, independent scroll):
    - *Configuration* section: key/value rows (Provider, Model, Directory, Config
      file, MCP servers in use) + an "Edit" button opening the edit modal.
    - *Skills* section: chip list of skills currently enabled on this agent + "Manage"
      link (jumps to Skills screen).
    - *Session* card: token count, spend (amber), a 4px progress bar (purple fill) for
      % of context window used, caption underneath.
- **Edit modal** (opened via rail's Edit button): centered overlay (`rgba(6,7,10,0.66)`
  scrim), 520px-max card (`#111216` bg, `#262933` border, 12px radius, drop shadow).
  Sections top to bottom: Name (read-only display), System prompt (textarea + live
  character count + helper caption), Provider (3-column picker cards), Model (radio-
  style list scoped to the chosen provider, showing price per row), Working directory
  (read-only path + "Choose…" button), Skills (toggleable pill chips), MCP servers
  (toggleable pill chips + "Manage servers" link to the MCP screen). Footer: helper
  text "Changes are written back to agent.toml" + Cancel/Save changes buttons (Save
  filled purple). Edits are staged in a local draft and only committed to the agent's
  live config on Save.

### 3. Skills
- **Purpose**: browse and edit the shared skill library (each skill = a folder with a
  SKILL.md and supporting files).
- **Header** (44px): "Skills" title, path breadcrumb (`~/roster/skills`, monospace),
  right-aligned "Reveal in Finder" + "New skill" (purple) buttons.
- **Three-pane body**:
  - *File tree* (196px, `#0d0e12`): folder/file rows indented by depth, active file
    highlighted (`#1c1e26` bg), monospace for files, sans for folders.
  - *Editor* (flex, `#0f1015`): header bar with open filepath, "unsaved" dot indicator,
    Revert/Save buttons; body is a plain line-numbered code view (46px gutter,
    monospace 12.5px/1.75, markdown-aware coloring: headers bold white, backticked/
    code spans purple, list items light gray).
  - *Metadata rail* (188px, `#0d0e12`): "Used by" (agents currently referencing this
    skill, colored dot + name), "Files" (static file list), "Last edited" timestamp.

### 4. MCP Servers
- **Purpose**: manage installed MCP servers and browse a registry to install more.
- **Header** (44px): "MCP servers" title + Installed/Registry segmented toggle (same
  visual treatment as the chat/terminal toggle).
- **Installed tab**: list of server cards (max-width 940px) — each shows a 22px icon
  placeholder, server name, launch command (monospace), agent count summary, and a row
  of per-agent toggle chips (colored/dot when enabled for that agent) to wire the
  server into specific agents.
- **Registry tab**: servers grouped under category headers (Code & repos, Data,
  Workspace) in an auto-fill grid (min 232px cards) — each card: icon placeholder,
  name, description (min-height 36px for alignment), author (monospace), Install
  button (purple text, bordered).

### 5. New Agent
- **Purpose**: create-agent form, full-height centered single column (max-width 560px).
- Sections top to bottom: title + one-line product description, divider, Name (static
  display value in the prototype), System prompt (textarea), Provider (3-column
  picker), Model (radio list w/ price), Working directory (path + Choose… button),
  Skills (toggleable chips), and a footer row with Cancel / Create agent (purple)
  buttons. Layout and components reuse the same patterns as the Edit modal's fields.

## Interactions & Behavior
- Sidebar nav switches the main screen (`grid`/`skills`/`mcp`/`new`/`tasks`/`spend`).
- Sidebar agent list and grid cards both open Agent Detail; clicking a session chip on
  a card opens that specific session directly.
- Session tab strip switches the active session per agent; chat auto-scrolls to bottom
  whenever the active screen/agent/session/mode changes.
- Chat/Terminal segmented control switches the primary pane's content without altering
  layout chrome.
- Tool-call messages expand/collapse independently (state keyed per message id).
- Spawn/Handoff messages navigate across agents and sessions — this is how the UI
  represents one agent delegating work to another.
- Approval banner and Approve/Deny actions are shown per session when that session's
  status is `approval`; Deny/Approve are visual-only in the prototype (no state change
  wired).
- Edit modal: opening it snapshots current provider/model/skills/MCP/prompt into a
  draft; all edits happen on the draft; Save commits the draft back onto the agent,
  Cancel discards it.
- Provider selection in both the Edit modal and New Agent form filters the Model list
  to that provider's models.
- Grid and sidebar search/filter inputs are simple case-insensitive substring matches
  against agent name (sidebar) or agent name + session titles (grid).
- Hover states throughout: subtle background lightening (`#1a1c23`/`#1c1e26`) or border
  brightening (`#33363f`/`#3a3d47`) — no color-only hover-only affordances beyond that.

## State Management
Needed state (see prototype's `state` object for exact shape):
- `screen`: which top-level view is active (`grid`/`agent`/`skills`/`mcp`/`new`).
- `agentId`: the agent currently open in Agent Detail.
- `mode`: `chat` or `terminal` — which pane is primary.
- `sess`: map of agentId → currently selected session id (per agent, so switching
  agents preserves each agent's last-viewed session).
- `mcpTab`: `installed` or `registry`.
- `openTools`: map of tool-call message id → expanded/collapsed.
- `query` / `gridQuery`: sidebar and grid search text.
- `provider` / `model`: New Agent form selections.
- `editOpen`, `draft`: Edit modal open flag and its staged (uncommitted) field values.
- `overrides`: per-agent provider/model overrides once saved.
- `agentSkills`: per-agent enabled-skill map once saved.
- `prompts`: per-agent system prompt overrides once saved.
- `picked`: New Agent form's selected skill chips.
- `mcpOn`: per (server, agent) toggle state for MCP wiring.
- `typed`: terminal's current input line (demo-only in the prototype).

Data model backing the demo (would come from a real backend/local store):
agents (id, name, model, provider, status, cwd, tokens, cost, recent transcript
lines), sessions per agent (id, title, origin, status, project id), messages per
session (text / tool-call / spawn / handoff), terminal lines per session, MCP
servers (name, launch command, which agents have it enabled), skill library (name,
file count, per-agent assignment), per-agent system prompts, projects (id, name,
color, description), and tasks (id, title, description (Markdown), status, assignee
agent id or null, priority, labels, project id or null, comments, history log).

### 6. Tasks (Linear-style kanban)
- **Purpose**: a shared task board — humans and agents both create, pick up, and
  progress tasks; this is how work gets assigned and tracked outside of chat.
- **Header** (44px): "Tasks" title, live summary ("N tasks · N in review"),
  project-filter dropdown ("All projects" + one per project), "Projects" button
  (bordered) opening the Projects modal, filter input (200px), "New task" button
  (purple, opens the New Task modal).
- **Board**: 4 fixed columns — To Do, In Progress, In Review, Done — each a
  `#0d0e12` panel (1px `#1e2027` border, 10px radius) with a header (status dot +
  label + monospace count) and a vertically scrolling card list. Columns are HTML5
  drag targets (`onDragOver`/`onDrop`); cards are `draggable` and set `draggingTaskId`
  on drag-start — dropping on a column moves the task to that status and appends a
  History entry.
- **Task card**: `#15161c` bg, 1px `#1e2027` border with a 2px left accent colored by
  priority, 8px radius. Contents: task id (monospace, `#5f6270`), title (12.5px),
  label chips (10px, `#1a1c23` bg), and a footer row — 18×18px assignee avatar
  (initials, ring colored by agent status, empty ring `#33363f` when unassigned),
  project dot+name (10.5px, `#8f93a3`) when the task has a project, and a trailing
  comment count (monospace, only shown when >0).
- **Task detail modal** (opened by clicking a card): wide two-column layout, 800px
  max-width, Linear-style.
  - **Left panel** (flex, scrolling): id in the header bar; large click-to-edit title
    (19px, click turns it into an input, Enter/blur saves, Escape cancels); a big
    description area that renders Markdown (`#`/`##`/`###` headings, `**bold**`,
    `` `code` ``, `- ` list items) — clicking it switches to a raw-markdown textarea
    (monospace, autofocus) with Cancel/Save; below that a **Comments / History**
    segmented tab (same visual treatment as the chat/terminal toggle) — Comments is
    a plain reverse-chron thread with an add-comment input pinned under it, History
    is a separate auto-generated log (status changes, (re)assignment, label add/
    remove, priority change) so those events never pollute the comment thread.
  - **Right rail** (196px, `#0d0e12`, bordered-left): small styled `<select>` fields
    (custom chevron, dark bg, matches modal chrome) for Status and Priority; Project
    is also a small select ("No project" + one per project); Assignee is a type-to-
    filter autocomplete text input (typing filters a suggestion dropdown of agent
    names + "Unassigned", picking one assigns and closes the list) with an inline
    "×" clear button (centered in the input) shown whenever someone's assigned;
    Labels show as removable pill chips (each with a "−" remove control) plus a
    dashed "+ Add" chip that opens an inline text input (Enter confirms, Escape/blur
    cancels).
  - Clicking the modal's backdrop (not the card itself) closes it, same as the New
    Task and Projects modals.
  - Assigning an agent auto-logs "{agent} picked up this task." to History and moves
    a To Do task to In Progress; any status/priority/label/assignee change logs its
    own History line attributed to the acting agent or "You".
- **New Task modal**: same chrome as the task detail modal's editing controls —
  title input, description textarea, Assignee/Priority/Project as small selects,
  labels with the same add/remove chip pattern, Cancel/"Create task" footer.
- **Backlog tab** (switcher next to the header title, Backlog shown left of Board):
  a separate list view for tasks not yet ready to schedule — this is where ideas and
  not-yet-prioritized work live, off the kanban board. Tasks only appear here while
  their status is `backlog` (a 5th status, not shown as a kanban column); moving a
  task's Status to To Do/In Progress/etc. (from either this view or the floating
  modal) puts it onto the board.
  - **Left sidebar** (220px): search input, Project + Priority filter dropdowns, a
    dashed "+ New backlog task" button (opens the New Task modal pre-set to Backlog
    status), and a scrolling list of backlog task rows (id, title, project dot+name)
    — clicking a row selects it, shown with a highlighted background.
  - **Right detail panel**: the exact same editable fields as the floating task
    detail modal (click-to-edit title, Markdown description editor, Status/
    Assignee/Priority/Project selects, Labels, Comments/History tabs) rendered
    inline instead of as a popup, bound to whichever backlog task is selected in
    the sidebar.
- **Projects modal** (opened via the "Projects" header button): list of existing
  projects, each row showing a color dot, name, live task count, and Edit/Delete
  controls; Edit expands the row in place into name + description fields plus a row
  of color swatches (6-color palette) with Cancel/Save; a dashed "+ New project"
  row at the bottom opens the same field set for creating one. Deleting a project
  removes it from the board's filter and project-select lists (tasks keep their
  reference but it simply won't resolve to a visible project any more).

### 7. Spend
- **Purpose**: cost visibility across the roster, grouped three ways.
- **Header** (44px): "Spend" title + running total across all agents.
- **Body** (max-width 640px, single scrolling column): three grouped horizontal bar
  charts, each row a label + an 8px (6px for the model sub-rows) rounded track bar
  sized relative to the group's largest value + a right-aligned dollar figure
  (monospace, amber `#d9a04a`/`#b98a3a`), sorted descending by spend:
  - **By provider**: one bar per LLM provider in use, with each provider's models
    nested underneath as smaller indented sub-bars (own scale within that provider)
    so you can see e.g. Anthropic's total and its per-model breakdown together.
  - **By agent**: one bar per agent, bar color matches that agent's status dot.
  - **By project**: one bar per project (color from the project's swatch) plus a
    "No project" bucket; an agent's cost is split evenly across its open sessions
    and attributed to each session's project.

## Design Tokens

**Colors**
- Background base: `#111216` (app), `#0d0e12` (sidebar/rails), `#0f1015` /
  `#101116` / `#131419` / `#15161c` (nested surfaces, darkest to card-level)
- Borders: `#1e2027` (default), `#24262f` / `#262933` (inputs, cards), `#2a2d38`
  (dashed), `#33363f` / `#3a3d47` (hover)
- Text: `#e6e6ea` (primary), `#d2d4dd` / `#c8cad4` (secondary), `#9a9daa` / `#8f93a3`
  (tertiary), `#6d707d` / `#5f6270` (muted), `#4f5260` / `#585b67` (faint/labels)
- Accent purple (primary action / running): `#7c5cff`, hover `#8f74ff`; light variant
  `#a78bfa` / `#c4b5fd` (links); purple-tinted surfaces `#1a1626` / `#171420` /
  `#26283a`; purple border `#3a3050` / `#2e2a3d`
- Amber (needs-approval / warning): `#d9a04a`, hover `#e8b262`; surface `#1c1710`,
  border `#3a2f18`, text-on-amber `#1a1508`
- Green (done/success): `#4fa86a`
- Red (error, defined not currently used): `#c2553f`

**Typography**
- UI font: Instrument Sans (400–700, incl. italics), Google Fonts
- Monospace: JetBrains Mono (400/500/600), for code, paths, counts, timestamps, prices
- Base size 13px; scale used: 10px–24px (nav meta 10.5–11px, body 12–13.5px, chat text
  13.5px, section titles 10.5px uppercase w/ 0.07em letter-spacing, page title 24px on
  New Agent)

**Spacing & radius**
- Sidebar width 216px, config rail 260px, skills tree 196px / metadata rail 188px,
  header height 44px
- Card radius 10px, chip/pill radius 6–8px, small pill radius 5–7px, avatar radius 6px,
  fully round (50%) for status dots and provider radio rings
- Grid gap 24px (agent cards), 18px page padding; form field gap 7px within a field,
  20–28px between form sections

**Motion**
- `rosterPulse`: 2s ease-in-out infinite border/shadow pulse on approval-needed cards
- `rosterBlink`: 1–1.1s step blink for streaming indicator dot and terminal cursor
- Hover transitions are instant color/background swaps (no explicit transition timing
  authored — recommend ~120ms ease in implementation)

**Task-specific tokens**
- Priority accent (task card left border / priority select): urgent `#c2553f`, high
  `#d9a04a`, medium `#7c5cff`, low `#4f5260`
- Kanban column status dots: To Do `#6d707d`, In Progress `#7c5cff`, In Review
  `#d9a04a`, Done `#4fa86a`
- Project color palette (swatch picker in the Projects modal): `#7c5cff`, `#d9a04a`,
  `#4fa86a`, `#5b9bd9`, `#c2553f`, `#8f93a3`

## Assets
No external images or icons — all glyphs are plain characters (•, ↳, ›, ×, ▸/▾) and
all "icons" (logo mark, avatar, MCP server icons) are flat colored rounded squares/
circles as placeholders. Any real product icon set can replace these directly.

## Screenshots
`screenshots/01-agents-grid.png`, `02-skills.png`, `03-mcp-servers.png`,
`04-tasks-board.png`, `05-tasks-backlog.png`, `06-spend.png` — reference captures of
those screens. Agent Detail and New Agent aren't captured here; open
`Roster.dc.html` directly and click into an agent card / "New agent" to see them live.

## Files
- `Roster.dc.html` — the full prototype (single file, inline styles, demo data and
  interaction logic included). Every screen, state, and color value described above
  is implemented there — refer to it directly for exact structure when the README is
  ambiguous.
