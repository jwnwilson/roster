# Design fidelity audit — 2026-08-16

The gap `ui-design-gaps.md` predicted and never closed: *"The tokens are exact;
whether each component *uses* the right one is unverified."* It closed the
token-level gap — every colour the canvas uses now has a token — and never
checked the wiring.

## Method

For each screen section of `docs/design/README.md`, every `#rrggbb` the handoff
names was resolved to its token, and that token looked for in the components
that build the screen (plus the shared primitives every screen composes). A
colour the handoff names for a screen whose token appears nowhere in it is a
candidate mismatch — either the wrong token is wired, or the element is missing.

Candidates are **not** findings until read against the component: a token can be
legitimately absent because the element it belongs to is deliberately unbuilt.

## Candidates by screen

### Sidebar  (7 spec colours not wired)
   #25272e  -> text-faint-3
   #20222a  -> text-faint-4
   #4a4d56  -> agent-disabled
   #181a22  -> bg-badge
   #6a6d78  -> text-label-2
   #9a9da6  -> text-muted-3
   #72757e  -> text-secondary-3

### Topbar (all screens)  (2 spec colours not wired)
   #66696f  -> text-label-3
   #c0c2c8  -> text-read

### Chat Panel  (5 spec colours not wired)
   #09090c  -> bg-chat
   #080a0d  -> bg-sidebar
   #2e3038  -> stroke-idle
   #b0b2b8  -> text-message
   #20222a  -> text-faint-4

### Screen A — Issues List  (10 spec colours not wired)
   #2e3038  -> stroke-idle
   #4a4d56  -> agent-disabled
   #25272e  -> text-faint-3
   #d0d2d8  -> text-strong
   #b0b2b8  -> text-message
   #64676f  -> text-label-4
   #7a7d86  -> text-secondary-2
   #3a3d46  -> stroke-todo
   #22252c  -> text-7
   #1e2028  -> text-faint-5

### Screen B — Board View (Primary Shell)  (5 spec colours not wired)
   #28292e  -> text-faint-2
   #4a4d56  -> agent-disabled
   #0c0d10  -> bg-column-active
   #141618  -> bg-panel
   #c8c9ce  -> text-card

### Screen D — Work Item Detail (Spec tab, default)  (6 spec colours not wired)
   #25272e  -> text-faint-3
   #7a7d86  -> text-secondary-2
   #8a86d0  -> accent-muted
   #2e3038  -> stroke-idle
   #d8d9de  -> text-bright
   #1e2028  -> text-faint-5

### Screen C — Agents  (6 spec colours not wired)
   #0b0d10  -> bg-strip
   #3a3d45  -> text-dim-2
   #4a8c68  -> green/agent-working
   #4d7fd4  -> agent-active
   #4a4d56  -> agent-disabled
   #131519  -> bg-chip

### Screen C2 — Agent Detail  (2 spec colours not wired)
   #0b0d10  -> bg-strip
   #0a0b0d  -> bg-surface-2

### Screen K — MCP Servers  (1 spec colours not wired)
   #c78b3f  -> attention

### Screen G — Threads  (4 spec colours not wired)
   #c0c2c8  -> text-read
   #4868a0  -> blue-text/badge-info-text
   #3d6a48  -> badge-resolved-text
   #b0b2b8  -> text-message

### Screen E — Dashboard  (4 spec colours not wired)
   #4a8c68  -> green/agent-working
   #1e2028  -> text-faint-5
   #2a2d36  -> bg-chart-bar
   #25272e  -> text-faint-3

### Screen J — Settings (Secrets)  (1 spec colours not wired)
   #1c1e24  -> bg-toggle-off

## Findings that are not miswiring

Elements the handoff specifies that **do not exist**. A wrong colour is a
one-line fix; a missing element is a decision, so these are recorded rather than
invented — several depend on data roster does not have.

- **Kanban column `+` button** (§Screen B) — 18×18, opens the create-work-item
  flow for that column's status. `CreateWorkItemModal` exists and is reachable
  from the topbar, so this is wiring plus a status preset.
- **Kanban card row 3** (§Screen B) — epic tag + token count. `epic_id` is real;
  the token count is not backed by any entity (`tokens.usage` is a fixture).
- **Issues List column-header row** (§Screen A) — 28px, field labels at 9.5px
  monospace `#2e3038`.
- **Issues List row fields** (§Screen A) — epic tag, token count and age are
  specified and absent. `created_at` and `epic_id` are real; tokens are not.

## Deliberate deviations, worth confirming

- **Done status circle carries a checkmark.** §Status Circles specifies a filled
  circle and nothing more. The tick may be an improvement, but it is not what the
  handoff says.

## The handoff contradicts itself once

**Message bubble corner radii.** §Chat Panel gives `3px 9px 9px 9px`; §Screen G
gives `4px 12px 12px 12px`. `MessageList` renders in both places, so it cannot
satisfy both. It keeps §Screen G's values — what shipped, and the dedicated
screen for messages — and the chat panel would need its own variant to honour
§Chat Panel. **Worth a designer's ruling rather than a guess.**

## False positives this method produces

Three "unwired" colours on §Screen C and two on §Screen G were wrong. `StatusBadge`
reaches its palette through `var(--agent-working)` and friends in a `style`
object, and a search for Tailwind class names cannot see that. Any future run of
this audit should treat `var(--…)` usage as wiring too.

## Missing elements found in the second pass

- **Dashboard token chart** (§Screen E) — past bars, day labels, today's
  highlight. No chart component exists; it is entirely fixture data.
- **Dashboard active-agent count** (§Screen E) — the header's count in `#4a8c68`.
- **Agent local path** (§Screen C) — 10px monospace `#3a3d45` under the name.
