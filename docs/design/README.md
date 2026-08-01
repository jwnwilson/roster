# Handoff: roster UI — Agent Project Management

## Overview

This handoff covers the complete UI design for **roster** — a Linear-style project management interface for managing AI agents that work on git repository projects. Users manage work items (epics → features → tasks), configure agents, connect MCP servers, and hold every agent conversation in **Threads**.

**Three concepts drive the current design:**

1. **Agents are first-class and folder-backed.** An agent *is* a local folder — `AGENT.md` (instructions), `skills/` (one folder per skill), and `config.yaml` (model, token limit, temperature). roster reads them from disk and never stores agent config itself. Agents have no subagents. Statuses are only **Working**, **Active**, **Disabled**.
2. **Projects are not necessarily git repos.** A project's code location is optional — Git repository, Local folder, or No code (research, ops, writing). Every project instead has a **required artifact store** (an artifact repo, a local folder, or the project itself) where agents write specs, notes, reports and generated files.
3. **Threads replace the inbox.** Every agent conversation — action requests and ordinary discussion — lives in Threads, filtered by All / Action Needed and by project. The work-item detail page has no Agent tab; its Thread tab shows the same conversation scoped to that item.

---

## About the Design Files

The files in this bundle (`Roster Hi-Fi.dc.html`, `Roster Wireframes.dc.html`) are **HTML design references** — prototypes built to show the intended look, layout, and behaviour. They are **not production code to copy directly**. Your task is to recreate these designs in your existing React codebase using its established patterns and libraries (component system, routing, state management, etc.).

Open the HTML files in a browser and pan/zoom to see all screens side by side.

---

## Fidelity

**High-fidelity.** The hi-fi file (`Roster Hi-Fi.dc.html`) shows pixel-accurate colours, typography, spacing, borders, icons, and component states. Recreate it faithfully. The wireframes file is an earlier iteration — use it only to understand structural decisions, not visual polish.

---

## Design Tokens

These are the exact values used consistently across all screens.

### Colours

```
Background
  --bg-base:       #0e0f11   (page background, main content area)
  --bg-sidebar:    #080a0d   (sidebar background)
  --bg-surface:    #131618   (cards, chips, elevated panels)
  --bg-surface-2:  #0a0b0d   (chat panel background)
  --bg-input:      #101316   (input fields)
  --bg-overlay:    #1a1c22   (hover states, overlays)
  --bg-inset:      #07080a   (code blocks, log streams)

Text
  --text-1:  #e2e3e8   (headings, primary labels)
  --text-2:  #c4c5cb   (body text, card titles)
  --text-3:  #8a8d96   (secondary labels)
  --text-4:  #52555e   (tertiary, placeholder)
  --text-5:  #42454e   (disabled, metadata)
  --text-6:  #30333c   (very faint, timestamps)
  --text-7:  #22252c   (barely visible labels)

Borders
  --border-subtle:  rgba(255,255,255,0.055)  (sidebar, panel dividers)
  --border:         rgba(255,255,255,0.07)   (card borders)
  --border-strong:  rgba(255,255,255,0.09)   (interactive elements, inputs)

Accent (violet)
  --accent:          #7c6cf0
  --accent-bg:       rgba(124,108,240,0.10)
  --accent-bg-hover: rgba(124,108,240,0.14)
  --accent-border:   rgba(124,108,240,0.25)
  --accent-text:     #bab7f6

Status / semantic
  --green:      #4a8c68   (agent active/running badge)
  --green-bg:   rgba(74,140,104,0.10)
  --red-text:   #b05848   (stop button, danger)
  --red-border: rgba(180,60,60,0.20)
  --yellow-text: #907030   (review needed badge)
  --blue-text:   #4868a0   (info badge)
```

### Typography

```
UI font:   system-ui, -apple-system, BlinkMacSystemFont, sans-serif
Mono font: ui-monospace, 'SF Mono', Menlo, Consolas, monospace

Scale (use font-size in px):
  9px   — timestamps, very small badges
  9.5px — mono labels (TOKEN BUDGET, column headers), letter-spacing 0.07–0.09em
  10px  — mono metadata (token counts, age, file sizes)
  10.5px — secondary mono values
  11px  — nav items (inactive), small body text
  11.5px — list row titles, chat messages, input placeholders
  12px  — standard body, card content
  12.5px — nav items (active), breadcrumbs, inbox item titles
  13px  — topbar page title
  13.5px — topbar title (large views)
  15px  — settings/dashboard section headers
  17px  — work item detail title

Font weights:
  400 — body, metadata
  500 — active nav items, tab labels, important labels
  600 — section headers, card titles, page titles
  700 — avatar initials (monospace)
```

### Spacing

```
Base unit: 4px

Common values:
  4px   — tight padding in tags/chips
  5px   — button padding (vertical)
  6px   — small gap between elements
  7px   — icon + label gap in nav
  8px   — standard gap
  9px   — sidebar/topbar padding horizontal unit
  10px  — card padding, section footer padding
  11px  — card inner padding
  12px  — chat message padding
  13px  — chat panel padding
  14px  — list row horizontal padding, topbar horizontal padding
  16px  — detail page padding
  20px  — dashboard/detail content padding
  24px  — dashboard/spec content horizontal padding
```

### Border Radius

```
3px  — tag/badge inner radius (tightest)
4px  — status tags, hover chips, file attachment items
5px  — buttons, filter chips, nav items, inputs, small cards
6px  — agent chips, log stream containers
7px  — kanban cards
8px  — metric cards, settings cards, activity feed containers
9px  — main frame/panel containers
50%  — circular avatars (JW, agent avatars)
```

### Shadows

```
Frame:  0 8px 32px rgba(0,0,0,0.60)
Card:   none (border only)
Panel:  none (border only)
```

### Animation

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}

/* Running agent dot */
animation: pulse 2s infinite;
box-shadow: 0 0 0 2.5px rgba(124,108,240,0.20);

/* RUNNING badge */
animation: pulse 3s infinite;

/* Typing indicator dots */
.dot-1 { animation: pulse 1.2s 0.00s infinite; }
.dot-2 { animation: pulse 1.2s 0.25s infinite; }
.dot-3 { animation: pulse 1.2s 0.50s infinite; }
```

---

## Layout Architecture

### Shell Structure

Every screen uses the same outer shell:

```
┌─────────────────────────────────────────────────┐
│  Sidebar (214px fixed)  │  Main Content (flex:1) │ Chat Panel (292px, collapsible)
│                         │                        │
│  - Workspace header     │  - Topbar (44px)       │
│  - Search (28px)        │  - View-specific body  │
│  - Nav items            │                        │
│  - Project list         │                        │
│  - Token budget footer  │                        │
└─────────────────────────────────────────────────┘
```

### Sidebar

- **Width:** 214px, `flex: none`
- **Background:** `#080a0d`
- **Right border:** `1px solid rgba(255,255,255,0.055)`

**Workspace header** (48px tall):
- User avatar: 24px circle, `background: #1c1e26`, `border: 1.5px solid rgba(255,255,255,0.13)`, initials in `ui-monospace` 9.5px 700
- Name: 12.5px 600 `#e2e3e8`
- Workspace: 9px `#30333c` monospace
- Caret: `#25272e`

**Search bar** (28px tall, `background: #101316`, `border: 1px solid rgba(255,255,255,0.07)`, `border-radius: 5px`):
- Search icon: 11×11 SVG, `#30333c`
- Placeholder: 11.5px `#30333c`
- Shortcut: `⌘K` 9px monospace `#20222a`

**Nav items:**
- Inactive: `color: #4a4d56`, padding `5px 7px`, `border-radius: 5px`
- Active: `background: rgba(124,108,240,0.10)`, `color: #bab7f6`, `font-weight: 500`
- Icons: 13×13 SVG using `currentColor`
- Badges: `background: #181a22`, `border-radius: 8px`, 9px monospace

**Nav items list:**
1. Dashboard — 2×2 grid squares icon — `4 ●` in green when agents are running
2. Threads — chat-bubble icon — unread count badge
3. Agents — robot icon (rounded head, antenna, two eyes) — agent count, accent when active
4. MCP Servers — stacked-rack icon — connected server count

**Projects section** (below nav, `padding-top: 14px`):
- Section header row: label `PROJECTS` 9.5px `#6a6d78` monospace letter-spacing 0.08em, plus a **+ button** pushed right (17×17, `background: rgba(255,255,255,0.05)`, `border: 1px solid rgba(255,255,255,0.09)`, `border-radius: 4px`, `color: #9a9da6`) that opens the Create Project modal (B2). There is no "+ Add project" text row.
- Repo items: git-repo icon (11×11), 11.5px `#42454e`, count in 9px monospace
- Active repo: `background: rgba(124,108,240,0.08)`, `color: #bab7f6`, count in `#7c6cf0`

**Token budget footer** (`margin-top: auto`, `border-top: 1px solid rgba(255,255,255,0.05)`):
- Label: 9.5px monospace `#30333c`
- Value: 9.5px monospace `#72757e`
- Bar: 3px height, `background: #181a20`, fill `#7c6cf0`
- Settings active: settings icon + "Settings" label above bar with accent background

### Topbar (all screens)

- **Height:** 44px, `flex: none`
- **Border-bottom:** `1px solid rgba(255,255,255,0.055)`
- **Padding:** `0 14px`

Contents (left to right):
1. Page title — 13.5px 600 `#e2e3e8`
2. Item count — 10px monospace `#30333c`
3. Vertical divider — `1px solid rgba(255,255,255,0.08)`, 14px tall
4. Filter chips (see below)
5. `margin-left: auto` spacer
6. View switcher (list/grid toggle)
7. New button (primary CTA)

**Filter chip:** `height: 26px`, `padding: 0 9px`, `border: 1px solid rgba(255,255,255,0.09)`, `border-radius: 5px`, 11px `#66696f`, includes chevron SVG

**View switcher:** two buttons in a container with shared border. Active button: `background: rgba(255,255,255,0.07)`, `color: #c0c2c8`. Inactive: `color: #44474f`.

**New button:** `height: 28px`, `padding: 0 12px`, `background: #7c6cf0`, `border-radius: 5px`, 11.5px 500 white, plus-icon SVG

### Chat Panel

- **Width:** 292px (open) / 34px (collapsed)
- **Background:** `#09090c` (open) / `#080a0d` (collapsed)
- **Border-left:** `1px solid rgba(255,255,255,0.055)`

**Header** (44px):
- Active thread tab: `border-bottom: 2px solid #7c6cf0`, `color: #bab7f6`, 11.5px 500, includes 6px pulse dot
- Inactive tab: `color: #2e3038`, 11.5px
- Buttons: `+` (new thread) + `◂` (collapse), each in `border-left: 1px solid rgba(255,255,255,0.055)`

**Message bubbles:**
- Agent: `background: #131618`, `border: 1px solid rgba(255,255,255,0.07)`, `border-radius: 3px 9px 9px 9px`
- User: `background: rgba(124,108,240,0.11)`, `border: 1px solid rgba(124,108,240,0.16)`, `border-radius: 9px 3px 9px 9px`
- Agent avatar: 20px, `border-radius: 5px`, `background: #7c6cf0`, 7.5px 700 white monospace
- Message text: 12px `#b0b2b8` (agent) / `#bab7f6` (user), line-height 1.5

**Typing indicator:** three 5px circles with `#3a3d44`, staggered pulse animations

**Input area:**
- Container: `border: 1px solid rgba(255,255,255,0.09)`, `border-radius: 7px`, `background: #101316`
- Placeholder: 12px `#20222a`
- Context chips: `border: 1px solid rgba(255,255,255,0.08)`, `border-radius: 3px`, 9.5px monospace `#3a3d44`
- Send button: 22px square, `background: rgba(124,108,240,0.18)`, `border-radius: 5px`, `color: #7c6cf0`

---

## Screens

### Screen A — Issues List

**Route suggestion:** `/projects` with list view query param

**Layout:** Sidebar + Topbar + column headers (28px) + grouped list rows + collapsed chat strip (34px)

**Column headers row** (28px, `background: #0b0c0f`):
Fields: `[priority bar] [status] [ID 62px] [title flex:1] [epic 50px] [tokens 44px] [avatar 18px] [age 24px]`
Labels: 9.5px monospace `#2e3038`, letter-spacing 0.04em

**Group headers** (30px, `background: #0b0c0f`):
- Status SVG + group name (11.5px 600 `#c4c5cb`) + count (9.5px monospace `#30333c`) + token total + chevron
- Background slightly darker than rows

**List rows** (34px each, `border-bottom: 1px solid rgba(255,255,255,0.03)`):
- Priority bars: 3 vertical bars (3×4px, 3×7px, 3×10px), `border-radius: 1px`, grey `#4a4d56` or faint `#25272e`
- Status circle: 13×13 SVG (see Status Circles below)
- ID: 10.5px monospace `#30333c`, fixed 62px
- Title: 12.5px `#d0d2d8` (in-progress), `#b0b2b8` (todo), truncated
- Epic tag: `padding: 2px 7px`, `border: 1px solid rgba(255,255,255,0.08)`, `border-radius: 4px`, 9.5px monospace `#64676f`
- Token count: 10px monospace `#30333c`
- Agent avatar: 18px circle, `background: #1c1e26`, `border: 1px solid rgba(255,255,255,0.09)`, 7.5px 600 `#7a7d86` monospace
- Age: 10px monospace `#30333c`

**Status Circles (SVG, 13×13, viewBox="0 0 13 13"):**
```
Backlog:     <circle cx="6.5" cy="6.5" r="4.5" stroke="#25272e" stroke-width="1.5" stroke-dasharray="2.5 2" fill="none"/>
Todo:        <circle cx="6.5" cy="6.5" r="4.5" stroke="#3a3d46" stroke-width="1.5" fill="none"/>
In Progress: <circle cx="6.5" cy="6.5" r="4.5" stroke="#22252c" stroke-width="1.5" fill="none"/>
             + <circle cx="6.5" cy="6.5" r="4.5" stroke="#7c6cf0" stroke-width="1.5" stroke-dasharray="14.14 14.14" transform="rotate(-90 6.5 6.5)" fill="none"/>
In Review:   Same but stroke-dasharray="21.2 7.07" (3/4 filled), stroke="#52555e"
Done:        <circle cx="6.5" cy="6.5" r="4.5" fill="#1e2028"/>
             + <path d="M4.5 6.5l1.5 1.5 2.5-2.5" stroke="#0b0c0f" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
```
Circumference formula: `2π × 4.5 ≈ 28.27`. Half = 14.14. Three-quarters = 21.2.

**Collapsed chat strip** (34px wide):
- Small icon box (14×14, `border: 1px solid rgba(255,255,255,0.10)`, `border-radius: 3px`)
- "CHAT ⌘J" vertical text, 8.5px monospace `#1e2028`, letter-spacing 0.09em

---

### Screen B — Board View (Primary Shell)

**Route suggestion:** `/projects?view=board` — **this is the default view**

**Layout:** Sidebar + Topbar (board icon active) + Live agents ribbon (76px) + Kanban columns (flex:1) + Chat panel (292px)

**Live agents ribbon** (`height: 76px`, `background: #0b0c0f`, `border-bottom: 1px solid rgba(255,255,255,0.055)`):
- Label: `LIVE AGENTS` 9.5px monospace `#28292e`
- Agent chips: see Agent Chip below

**Agent Chip** (running, `min-width: 170px`, `padding: 9px 11px`, `background: #131618`, `border: 1px solid rgba(255,255,255,0.07)`, `border-radius: 7px`):
```
Row 1: [6px pulse dot] [agent name 11px 600 #c4c5cb flex:1] [RUN label 8.5px monospace #7c6cf0]
Row 2: task description 10px #4a4d56 (truncated)
Row 3: progress bar — 2px height, #1a1c22 bg, #7c6cf0 fill, border-radius 1px
```
Pulse dot: `background: #7c6cf0`, `box-shadow: 0 0 0 2.5px rgba(124,108,240,0.20)`, `animation: pulse 2s infinite`

**Agent Chip** (idle, `min-width: 132px`, `background: #0e0f11`, `border: 1px solid rgba(255,255,255,0.05)`):
```
Row 1: [6px circle outline border:#2e3038] [agent name 11px #30333c flex:1] [IDLE 8.5px monospace #22252c]
Row 2: "Awaiting task" 10px #22252c
```

**Kanban columns** (5 columns, each `flex:1`):
Each column: `border-right: 1px solid rgba(255,255,255,0.05)`

Column header (padding `10px 12px`):
- 12px circle status indicator + name (11.5px 600) + count (9.5px monospace) + `+` add button

In Progress column: `background: #0c0d10` (subtle highlight)

**Kanban Card** (`background: #141618`, `border-radius: 7px`, `padding: 10px`):
```
Row 1: ID (9.5px monospace #30333c) + agent avatar (17px circle, right-aligned)
Row 2: title (12px #c8c9ce line-height:1.4)
Row 3: epic tag + token count (9px monospace)
```
In-progress card: `border: 1px solid rgba(124,108,240,0.18)` (rest same)
Token count on in-progress: `color: #7c6cf0`

Column `+` button: 18×18, `border: 1px solid rgba(255,255,255,0.07)`, `border-radius: 4px`, `color: #42454e`
In-progress column `+` button: `border: 1px solid rgba(124,108,240,0.20)`, `color: #7c6cf0`

---

### Screen D — Work Item Detail (Spec tab, default)

**Route suggestion:** `/projects/:projectId/items/:itemId`

**Layout:** Sidebar + Main (breadcrumb 34px + item header + tabs + body split) + Chat panel (292px)

**Breadcrumb bar** (34px, `padding: 0 16px`):
- `project > epic > feature > item-id` — 11px `#42454e`, chevrons `#25272e`
- Item ID: `#8a8d96`

**Item header** (`padding: 16px 16px 0`):
- Status circle (14×14 SVG) + title (17px 600 `#e2e3e8`) stacked vertically
- Metadata row: status button, priority button, agent selector — all `height: 28px`, `padding: 4px 9px`, `border: 1px solid rgba(255,255,255,0.09)`, `border-radius: 5px`, 11px `#7a7d86`
- Epic tag: `background: rgba(124,108,240,0.08)`, `border: 1px solid rgba(124,108,240,0.15)`, `border-radius: 4px`, `color: #8a86d0` monospace

**Tab bar** (`font-size: 11.5px`):
- Active: `border-bottom: 2px solid #7c6cf0`, `color: #bab7f6`, 500
- Inactive: `border-bottom: 2px solid transparent`, `color: #42454e`
- Agent tab: includes a 6px pulse dot when an agent run is active

**Tab list:** Spec · Attachments · Activity · Agent · Subagents

**Spec body** (left pane, `flex: 1`, `padding: 20px 24px`):
- `MARKDOWN SPEC` label: 9.5px monospace `#2e3038` with `agent-editable` badge
- Divider: `1px solid rgba(255,255,255,0.05)`
- H1: 15.5px 600 `#d8d9de`
- Body text: 13px `#8a8d96`, line-height 1.72
- H2: 13.5px 600 `#d8d9de`
- Checklist items: 15×15 checkbox (`border-radius: 3px`), checked = violet background + SVG checkmark
- Code block: `background: #07080a`, `border: 1px solid rgba(255,255,255,0.06)`, `border-radius: 6px`, 11px monospace

**Right rail** (252px, `border-left: 1px solid rgba(255,255,255,0.055)`):

Sections:
1. **PROPERTIES** — key/value rows (12px), key `#42454e` 80px fixed, value `#8a8d96` (or `#bab7f6` for status)
2. **TOKEN USAGE** — "This run" + progress bar (3px, `#7c6cf0`), "All runs" + secondary bar (`#44474f`)
3. **RECENT ACTIVITY** — timeline: vertical 1px line `#1e2028`, events 11px `#42454e`, timestamp 9px monospace `#22252c`. Active event: 6px accent dot.
4. **ATTACHMENTS** — file rows with document SVG icon, 11px `#52555e`, size 9px monospace `#25272e`

---

### Screen D3 — Work Item Detail (Thread tab)

Same shell as D, Thread tab active. The scoped agent conversation for this work item — the only place agent run output is surfaced on a work item (the old Agent monitor tab is gone).

---

### Screen D4 — Work Item Detail (Attachments tab)

Same shell as D, Attachments tab active.

- **Header row:** `ATTACHMENTS` mono label + "6 files · 4.2 MB" + primary **Upload file** button
- **Dropzone:** `border: 1px dashed rgba(124,108,240,0.35)`, `background: rgba(124,108,240,0.045)`, `border-radius: 8px`, `padding: 20px`, upload arrow SVG in `#7c6cf0`, "Drop files here, or browse", helper line "Agents can read every attachment · 25 MB per file"
- **Filters:** All / Uploaded / Agent output (accent pill on active), "Newest first" right-aligned
- **File rows** (`background: #101214`, `border-radius: 8px`): 30px extension tile tinted per type · filename 12.5px `#d0d2d8` · meta line `size · author · age` 10.5px mono · source chip (**Uploaded** grey / **Agent output** accent) · download + overflow buttons
- The right rail's ATTACHMENTS block mirrors the first two files in this list

---

### Screen D5 — Work Item Detail (Activity tab)

Same shell as D, Activity tab active.

- **Header row:** `ACTIVITY HISTORY` + event count, filters All / Agent / People / Status
- **Timeline:** 22px actor tile (agent or person, tinted per actor) with a 1px connector line running to the next entry; day separators (`TODAY`) in 9.5px mono `#2a2d34`
- **Entry:** actor name 12px 600 `#d0d2d8` + verb `#8f929b` + object in accent mono + relative timestamp `#2e3038`
- **Detail card** (optional, per entry): `background: #101214`, `border: 1px solid rgba(255,255,255,0.055)`, `border-radius: 6px`, 11.5px `#52555e`; diff counts render in `#4a8c68`
- Event kinds: commits pushed, status moves, comments, attachments added, agent started (with model + skills loaded from its folder), priority set, assignment, creation

---

### Screen C — Agents

**Route suggestion:** `/agents`

**Layout:** Sidebar (Agents active) + full-width table.

- **Topbar:** "Agents" + "6 folders · 3 working" + filters All / Working / Active / Disabled + **Rescan folders** + primary **+ Add agent folder**
- **Folder contract strip** (`background: #0b0d10`): `AGENT FOLDER` label, mono chips `AGENT.md` `skills/` `config.yaml`, the sentence "Instructions, skills and model are read from disk — roster never stores agent config itself.", "Last scan 2m ago" right-aligned
- **Columns:** `grid-template-columns: 292px 118px 1fr 168px 76px 74px 88px`, gap 16px, padding `13px 24px`
  `AGENT · PATH` · `STATUS` · `CURRENT WORK ITEM` · `MODEL · config.yaml` · `SKILLS` · `MCPS` · `SPEND`
- **Agent cell:** 26px initial tile tinted per agent + name 12.5px 600 + local path 10px mono `#3a3d45`
- **Status chips (only three):** Working `#4a8c68`, Active `#4d7fd4`, Disabled `#4a4d56` — dot + label, 10.5px mono, `border-radius: 9px`
- **Model chip:** 10.5px mono `#52555e` on `#131519`, `white-space: nowrap` (value comes from that agent's `config.yaml`)
- **Footer:** today's tokens, spend, work items touched, budget reset countdown

---

### Screen C2 — Agent Detail

**Route suggestion:** `/agents/:name`

**Layout:** Sidebar (Agents active) + breadcrumb topbar + identity strip + two-column body.

- **Topbar:** `Agents › atlas` + status chip + **Reveal folder** · **Disable** (red outline) · primary **Save to disk**
- **Identity strip** (`background: #0b0d10`): 38px tile, label `AGENT NAME · RENAMES THE FOLDER`, a focused text field (`border: 1px solid rgba(124,108,240,0.35)` + caret) whose value renames the folder on disk, live path preview `~/.roster/agents/<name>/`, and stat blocks SKILLS · MCPS · SPEND TODAY · LAST SCAN
- **Left column — AGENT.md editor:** file path caption, **Unsaved edits** chip (amber), Edit/Preview segmented control, editor surface `background: #0a0b0d`, 12px/1.55 mono, markdown headings in `#bab7f6`; footer "Changes write straight to the file on disk"
- **Right rail (372px):**
  - `CONFIG.YAML` card — **MODEL** select plus three quick-pick chips (sonnet-4.5 / opus-4.1 / haiku-4.5), MAX TOKENS / RUN, TEMPERATURE
  - `SKILLS` — one row per folder under `skills/`, each showing `SKILL.md`
  - `MCP SERVERS` — attached servers with connection dots and state

---

### Screen K — MCP Servers

**Route suggestion:** `/mcp`

**Layout:** Sidebar (MCP Servers active) + full-width table.

- **Topbar:** "MCP Servers" + "6 servers · 4 connected" + filters All / Connected / Needs attention / Disabled + **Test all** + primary **+ Add server**
- **Attention strip:** `1 SERVER NEEDS ATTENTION` + plain-language cause + **Reauthorize** button (amber outline) + "Health checked 40s ago"
- **Columns:** `300px 128px 1fr 92px 96px 104px 92px` — `SERVER · ENDPOINT` · `STATUS` · `TRANSPORT` · `TOOLS` · `USED BY` · `CALLS TODAY` · `P50`
- **Status chips:** Connected `#4a8c68`, Auth expired `#c78b3f`, Disabled `#4a4d56`
- **Footer:** total tool calls, tools exposed, agents connected, "Servers are defined per workspace, granted per agent"

---

### Screen K2 — MCP Server Detail

**Route suggestion:** `/mcp/:name`

**Layout:** Sidebar (MCP Servers active) + breadcrumb topbar + stat strip + two-column body.

- **Topbar:** `MCP Servers › github` + status chip + **Test connection** · **Disable** · primary **Save changes**
- **Stat strip:** 38px tile + TOOLS EXPOSED · AGENTS WITH ACCESS · CALLS TODAY · P50 LATENCY + "last handshake 40s ago"
- **Left column:**
  - `CONNECTION` card — TRANSPORT select, AUTH (secret name + "from Secrets" in green, linking to Screen J), COMMAND in a mono code field
  - `RECENT CALLS` — 5-column mono log: time · agent · tool · argument summary · latency (denied calls in `#c25b5b`)
- **Right rail (392px):**
  - `TOOLS` — every tool the server exposes with a per-tool enable toggle (26×15 pill, knob 11px, on = `#7c6cf0`)
  - `AGENT ACCESS` — one row per agent: tile, name, scope label (All tools / Read-only / No access), toggle
- Counts on this page must agree with the server's row in K

---

### Screen G — Threads

**Route suggestion:** `/threads`

**Layout:** Sidebar (Threads active) + thread list pane (356px) + conversation (flex:1). Threads is a global view — no project is selected in the sidebar while it is open.

**Notification list pane:**

Header (44px): title + unread count badge (`background: rgba(124,108,240,0.10)`, `border-radius: 8px`) + "Mark all read" button

Filter row (11.5px): **All** · **Action Needed** (with red count badge) — and, pushed to the right edge of the same row, a **project filter** button (`height: 24px`, `background: #101316`, `border: 1px solid rgba(255,255,255,0.09)`, repo icon + project name + caret). Only these two tabs exist.

**Notification item** (`padding: 13px 14px`, `border-bottom`):
- Badge: see badge types below
- Timestamp: 9px monospace right-aligned
- Title: 12.5px 500 `#e2e3e8` (unread) / `#c0c2c8` (read)
- Preview: 11px `#52555e` truncated
- Footer: agent avatar (16px) + agent name + `·` + item ID in accent colour

Selected item: `background: rgba(124,108,240,0.06)`, `border-left: 2px solid #7c6cf0`
Resolved item: `opacity: 0.4`

**Badge types:**
```
ACTION NEEDED:  bg rgba(190,65,50,0.12)  border rgba(190,65,50,0.20)  text #b05848
REVIEW NEEDED:  bg rgba(170,130,30,0.10) border rgba(170,130,30,0.18) text #907030
INFO:           bg rgba(50,80,160,0.10)  border rgba(50,80,160,0.18)  text #4868a0
RESOLVED:       bg rgba(50,110,60,0.08)  border rgba(50,110,60,0.14)  text #3d6a48
```
All badges: `border-radius: 3px`, 8.5px monospace, 600, letter-spacing 0.03em

**Extended conversation pane:**

Header (44px): agent avatar + name + item ID + badge + action buttons

Agent message format:
- Avatar: 22px, `border-radius: 5px`, `background: #7c6cf0`
- Bubble: `background: #131618`, `border: 1px solid rgba(255,255,255,0.07)`, `border-radius: 4px 12px 12px 12px`, 12.5px line-height 1.65 `#b0b2b8`

Quick action buttons (below agent message):
- Primary: `background: #7c6cf0`, white, 12px 500
- Secondary: `border: 1px solid rgba(255,255,255,0.12)`, `#8a8d96`
- Tertiary: `border: 1px solid rgba(255,255,255,0.09)`, `#52555e`

User message:
- `background: rgba(124,108,240,0.11)`, `border: 1px solid rgba(124,108,240,0.16)`, `border-radius: 12px 4px 12px 12px`, `color: #bab7f6`

Reply input (taller version of chat input):
- Context chips: `@agent-name`, `@ITEM-ID`, `+ attach`
- Send button: standard (12px 500 "Send ↑")

---

### Screen E — Dashboard

**Route suggestion:** `/dashboard`

**Layout:** Sidebar (Dashboard active) + main content area with padding

**Metric cards row** (4 cards, `display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px`):
- Each: `background: #131618`, `border: 1px solid rgba(255,255,255,0.07)`, `border-radius: 8px`, `padding: 15px`
- Label: 9.5px monospace `#30333c`, letter-spacing 0.07em
- Value: 30px 600 `#e2e3e8`
- Sub-text: 11px `#42454e` (or `#4a8c68` for active agents)
- Spend card: accent border `rgba(124,108,240,0.14)`, includes 3px progress bar + percentage in `#7c6cf0` monospace

**Two-column layout** (below cards, `display: grid; grid-template-columns: 1fr 1fr; gap: 16px`):

Left — Running agents panel (`background: #131618`, `border-radius: 8px`):
- Header: 12.5px 600 `#c4c5cb` + active count in `#4a8c68`
- Agent rows: pulse dot + name/task + mini progress bar + token count + Pause button
- Idle row: outline dot + muted name + Assign button

Right — Two stacked panels:
1. Token chart (`background: #131618`, `border-radius: 8px`, `padding: 15px`):
   - Bar chart using flexbox, `align-items: flex-end`, bars are `flex: 1` divs
   - Past bars: `background: #1e2028` or `#2a2d36`, `border-radius: 2px 2px 0 0`
   - Today's bar: `background: #7c6cf0`
   - Day labels: 9px monospace `#25272e` (today in `#7c6cf0`)

2. Activity feed (`background: #131618`, `border-radius: 8px`, `flex: 1`):
   - Each row: 5px dot + text 11.5px `#8a8d96` + timestamp 9px monospace `#25272e`
   - Violet dot for agent write actions, grey for status changes

---

### Screen J — Settings (Secrets)

**Route suggestion:** `/settings/secrets`

**Layout:** Sidebar + settings subnav (176px) + content.

**Settings subnav** (`background: #0a0b0d`, `padding: 16px 10px`):
- Section labels: 9.5px monospace `#22252c`, letter-spacing 0.08em
- Items: 12px `#52555e`, `padding: 5px 8px`, `border-radius: 5px`; active = `background: rgba(124,108,240,0.10)`, `color: #bab7f6`, 500
- **Sections are now:** WORKSPACE → General · BILLING → Budgets & Limits, Usage History · INTEGRATIONS → GitHub · SECURITY → Secrets
- Agents, Models and Tools were **removed** from settings — agents are configured from their folder (C2) and tools from their MCP server (K2)

**Secrets content:** stored credentials with masked values, scope, last-used metadata; MCP servers reference these by name (see K2's AUTH field).

**Toggle switch** (used in K2 and elsewhere): 26×15px container, `border-radius: 8px`. Knob 11px circle. On: knob right, `background: #7c6cf0`, white knob. Off: knob left, `background: #1c1e24`, `#3a3d44` knob.

---

## Interactions & Behaviour

### Navigation flows
- Sidebar nav → route change, active item gets accent background
- Clicking a kanban card → `/projects/:id/items/:itemId` (Detail screen)
- Clicking an agent name in the agents ribbon → Detail screen with Agent tab pre-selected
- Inbox item click → right pane updates to show that conversation
- "View ROS-XX ↗" in a thread → navigates to that work item's detail
- Sidebar Agents → `/agents` (C); an agent row → `/agents/:name` (C2)
- Sidebar MCP Servers → `/mcp` (K); a server row → `/mcp/:name` (K2)
- Sidebar PROJECTS **+** → Create Project modal (B2)

### Chat panel
- Collapsible: clicking `◂` collapses to 34px strip showing "CHAT ⌘J" vertical label; `▸` or clicking the strip re-expands
- Thread tabs: clicking another agent name switches the active thread
- `+` button opens a new conversation thread
- Persists open/closed state across navigation

### Board
- List/board toggle in topbar switches between Screen A and Screen B
- In-progress column has subtle background highlight (`#0c0d10`)
- The `+` button at top of each column opens a "new item" flow

### Status
- Running agents pulse animation is driven purely by CSS (`animation: pulse 2s infinite`)
- RUNNING badge on Agent tab also pulses (`animation: pulse 3s infinite`)
- Typing indicator uses staggered pulse delays (0s, 0.25s, 0.5s)

### Detail tabs
- Default tab: **Spec**
- Tabs are **Spec · Attachments · Activity · Thread** — there is no Agent tab; live agent output is read in the Thread tab (D3)

---

## Data Model

Key entities needed by the UI:

```typescript
type WorkItem = {
  id: string;           // "ROS-42"
  type: 'epic' | 'feature' | 'task';
  title: string;
  status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedAgent?: Agent;
  epicId?: string;
  featureId?: string;
  projectId: string;
  tokenUsageThisRun?: number;    // e.g. 12400
  tokenUsageAllRuns?: number;    // e.g. 68400
  tokenLimit?: number;           // e.g. 200000
  spec?: string;                 // markdown
  attachments?: Attachment[];
  createdAt: Date;
  updatedAt: Date;
};

type Agent = {
  id: string;                    // "agent-build-01"
  type: 'lead' | 'sub';
  model: string;                 // "claude-opus-4"
  status: 'running' | 'idle' | 'paused';
  currentItemId?: string;
  progress?: number;             // 0–1
  tokenUsage?: number;
  tokenLimit: number;
};

type Project = {
  id: string;
  name: string;                  // "api-service"
  repoUrl: string;
  itemCount: number;
};

type InboxItem = {
  id: string;
  type: 'action_needed' | 'review_needed' | 'info' | 'resolved';
  title: string;
  preview: string;
  agentId: string;
  workItemId: string;
  conversationId: string;
  createdAt: Date;
  read: boolean;
};

type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'agent' | 'lead_agent';
  agentId?: string;
  content: string;
  attachments?: Attachment[];
  createdAt: Date;
};

type AgentRun = {
  id: string;
  agentId: string;
  workItemId: string;
  status: 'running' | 'paused' | 'complete' | 'failed';
  steps: RunStep[];
  logLines: LogLine[];
  tokenUsage: number;
  cost: number;
  startedAt: Date;
};

type RunStep = {
  index: number;                 // 1–6
  label: 'Plan' | 'Read' | 'Analyze' | 'Generate' | 'Test' | 'PR';
  status: 'done' | 'active' | 'pending';
};

type LogLine = {
  timestamp: Date;
  type: 'tool_call' | 'result' | 'status';
  tool?: string;                 // "read_file"
  target?: string;               // "src/auth/token.py"
  message?: string;
};
```

---

## State Management Needs

| State | Where needed | Notes |
|-------|-------------|-------|
| Active view (list/board) | Board/List screens | Persist in URL or localStorage |
| Chat panel open/closed | All project screens | Persist in localStorage |
| Active chat thread | Chat panel | Per-page, not persisted |
| Agent live status | Board ribbon, Agent tab | Poll or WebSocket |
| Run log lines | Agent monitor | Stream via SSE/WebSocket |
| Inbox unread count | Sidebar badge | Real-time |
| Token budget | Sidebar footer | Refresh on interval |

---

## Icons

All icons in the design are simple geometric SVGs drawn inline. In React, create a small icon component for each:

| Icon | Used in |
|------|---------|
| Dashboard (2×2 grid squares) | Sidebar nav |
| Inbox (tray shape) | Sidebar nav |
| Projects (folder) | Sidebar nav |
| Agents (chip/CPU) | Sidebar nav |
| Settings (gear) | Sidebar footer |
| Search (circle + line) | Search bar |
| Git repo (window frame) | Project list |
| List (3 horizontal lines) | View switcher |
| Grid (2×2 squares outline) | View switcher |
| Plus | New button, column add |
| Chevron down | Filter chips, select dropdowns |
| Chevron right | Breadcrumb separator |
| Check | Done status circle, checklist |
| Document | Attachment items |

SVG source for all icons is available in the HTML reference file — each icon is 11–13px, using `currentColor` for fill/stroke, so they inherit colour from their parent element.

---

## Files in This Package

| File | Purpose |
|------|---------|
| `Roster Hi-Fi.dc.html` | **Primary reference** — all screens hi-fi, pannable canvas |
| `Roster Wireframes.dc.html` | Structural reference — earlier iteration, useful for layout intent |
| `README.md` | This document |

Open the HTML files in any modern browser. Use trackpad/scroll to pan, pinch or scroll+cmd to zoom.

---

## Canvas Layout (current)

| Row | Frames |
|-----|--------|
| Primary views & project modals | **A** Issues List · **B** Board · **B2** Create Project modal · **H** Create Work Item modal |
| Work item detail | **D** Spec · **D3** Thread · **D4** Attachments · **D5** Activity |
| Agents & MCP servers | **C** Agents · **C2** Agent Detail · **K** MCP Servers · **K2** MCP Server Detail |
| Threads | **G** Threads |
| Dashboard & profile | **E** Dashboard · **I** User Profile |
| Settings | **J** Settings — Secrets |

Frames sit at x = 80 / 1600 / 3120 / 4640 and each row is 990px apart; section labels sit 26px above each row's frame captions.

---

## Projects & Artifact Store

**Create Project modal (B2)** has two storage blocks:

1. `PROJECT TYPE` — segmented control **Git repository · Local folder · No code**, then the matching field (remote URL with a Valid chip, or a local path). Helper: "Optional. A project needs no code at all — pick No code for research, ops or writing work."
2. `ARTIFACT STORE` **(required, accent border)** — segmented control **Artifact repo · Local folder · Same as project**, then the target (e.g. `https://github.com/<org>/<project>-artifacts` or `~/.roster/artifacts/<project>`). Helper: "Where agents write specs, notes, reports and generated files. Specs and attachments are versioned here even when the project has no code."

**Elsewhere in the UI**
- Sidebar project rows use the git-repo icon for git projects and a plain folder icon for non-git ones (`infra` is the worked example)
- The A/B topbar shows an artifact-store chip beside the project name: folder icon + `artifacts · <store name>`
- D4 attachments and D5 activity entries are stored in and versioned by the artifact store, not the code repo

**Data model impact**

```
Project {
  id, name
  source:   { kind: 'git' | 'local' | 'none', url?, path? }   // optional
  artifacts:{ kind: 'git' | 'local' | 'source', url?, path? } // required
}
```

---

## Changelog — What Changed in This Revision

**Navigation**
- `Inbox` → **Threads**; `Projects` → **Agents** (agents are now a top-level destination, projects remain listed below the nav)
- New **MCP Servers** nav item
- PROJECTS group header gained a **+** button and higher-contrast label; the "+ Add project" row was removed

**Agents**
- Agents are folders on disk (`AGENT.md`, `skills/`, `config.yaml`); the model comes from `config.yaml`
- **No subagents anywhere** — the concept and its settings UI are gone
- Statuses reduced to Working / Active / Disabled; new MCPS column
- New **C2 Agent Detail**: rename (renames the folder), AGENT.md editor, model picker writing to `config.yaml`
- Agent naming aligned across all frames: `atlas`, `beacon`, `cinder`, `delta`, `ember`, `forge` (previously `agent-build-01` etc.)

**Work item detail**
- Agent monitor tab (old D2) removed — Thread carries that information
- New **D4 Attachments** (upload + agent-produced files) and **D5 Activity** (full history)

**Threads**
- Two tabs only (All, Action Needed) plus a project filter
- No project appears selected in the sidebar on this global view

**MCP**
- New **K** listing and **K2** detail (connection, per-tool toggles, per-agent access, recent calls)

**Projects**
- Project type is now Git repository / Local folder / No code; git is no longer assumed
- New required artifact store per project for agent-produced files
- Non-git projects get a folder icon in the sidebar; artifact store shown as a topbar chip

**Settings**
- Frame F removed; settings reduced to General, Billing, Integrations, Security (Secrets)
