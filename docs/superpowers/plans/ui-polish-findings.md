# UI polish audit — 2026-08-09

Written **before** any fixing, per plan Task 13 Step 1: an audit done while fixing
turns into a fixing session that skips half the screens.

## Scope and its honest limit

This audit is **structural, not visual**. It covers what can be verified by
reading and running the code: focus states, motion, and the screen × state
matrix. It does **not** cover pixel fidelity against `Roster Hi-Fi.dc.html` —
spacing, type scale application, border weights, and the exact shade of each
surface. That needs the canvas open beside a rendered screen and a human eye.

**What that means for "done".** Task 13 can close on everything below, but the
handoff-fidelity half of it stays open. It is listed under "Needs a human eye"
rather than quietly dropped, because the plan says the hi-fi canvas is the visual
authority and nothing here has actually been compared against it.

## Findings

### F1 — Focus is invisible on almost every interactive element (blocking)

Only 3 of 33 primitives carry any focus style: `TextInput`, `Textarea`, `Select`.
Every button, tab, nav item, filter chip, toggle, and thread row has none.

This is the whole keyboard path through the app. The plan says explicitly that
focus states "must be visible for keyboard users; this is the pass where that
gets fixed, not a later accessibility project."

**Fix:** a shared focus-visible ring token applied at the primitive level, so a
new component inherits it rather than remembering it.

### F2 — Motion ignores `prefers-reduced-motion` (blocking)

`PulseDot` and `TypingIndicator` animate unconditionally. There is no
`prefers-reduced-motion` rule anywhere in the tree. The handoff specifies the
pulse; it does not specify overriding an operating-system accessibility setting.

**Fix:** disable the animations under the media query, in `tokens.css` so it
covers anything added later.

### F3 — Two screens have no error state

`CreateProjectModal` and `CreateWorkItemModal` render `isPending` but no
`isError`. They do surface API failures — through the `error` string in their
`FormField` — so this is a false positive from the grep rather than a real gap.
Recorded so the next audit does not re-raise it.

### F4 — `MessageList` renders an empty conversation as an empty `<ol>`

A thread with no messages yet shows nothing at all, which is indistinguishable
from a thread that failed to load. Every other list in the app says something.

### F5 — Settings' General / Billing / Integrations panes are unbuilt

They say "not built yet", which is honest. The handoff specifies them as nav
items without content, so this is not a defect — recorded so it is not mistaken
for one.

## Screen × state matrix

| Screen | Loading | Empty | Error |
|---|---|---|---|
| Board | yes | yes | yes |
| Work item detail | yes | yes (missing item) | yes |
| Threads | yes | yes | yes |
| Work item Thread tab | yes | yes | yes |
| Agents | yes | yes | yes |
| Agent detail | yes | yes (no folder) | yes |
| Dashboard — agents panel | yes | yes | yes |
| Dashboard — cards/chart/feed | n/a (fixtures) | n/a | n/a |
| MCP list / detail | n/a (fixtures) | yes (no server) | n/a |
| Attachments | n/a (fixtures) | needs one (F4 sibling) | n/a |
| Settings — Secrets | n/a (fixtures) | needs one | n/a |
| Create modals | yes | n/a | yes (F3) |

## Needs a human eye

Not fixable from here, and not claimed as done:

- Every screen against the hi-fi canvas for spacing, type scale, and surface
  colour. The tokens are exact; whether each component *uses* the right one is
  unverified.
- The status-circle SVG geometry (handoff §Status Circles gives exact
  `stroke-dasharray` values for each state).
- Kanban card, list row, and sidebar dimensions against the handoff's pixel
  specifications.
