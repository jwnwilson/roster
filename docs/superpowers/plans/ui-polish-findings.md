# UI polish audit — 2026-08-09

> **Status:** F1, F2 and F4 fixed. F3 and F5 were false positives, recorded so a
> later audit does not re-raise them. The fidelity half remains open — see
> "Needs a human eye".

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

---

# External review — 2026-08-09

A second reviewer went over the branch and found 17 issues. All were verified
against the code before acting; **every one held**. All 17 are now fixed.

The three that mattered were gaps in my own completion claim, not nitpicks:

- **There was no topbar on any screen.** `Topbar` existed, was fully tested, and
  had no importer but its own test. That meant **Screen A (Issues List), required
  by spec §6, did not exist** — along with the view switcher and the primary New
  button. I had verified "no placeholder routes remain" and treated that as
  equivalent to "every screen exists". It is not.
- **Two finished features were unreachable.** `CreateWorkItemModal` and
  `postMessage` were both built and tested by rendering them directly, so the
  suite was green while no user could reach either. An agent could ask a question
  and there was no way to answer — the core loop, broken.
- **My focus test was hollow.** I mutation-checked it by deleting the whole rule,
  which it caught. The reviewer deleted one selector from *inside* the rule and it
  still passed, because it substring-matched the file and the word survived in a
  comment. Coarse mutation testing gives false confidence.

Also fixed: sidebar showing every project active at once (NavLink ignores the
query string), filtered lists rendering blank panes, mock handlers ignoring their
own filters (which is why the Thread tab showed the lead conversation and no test
could tell), the missing project filter / unread count / mark-all-read, the
artifact chip spec §6 keeps, modal focus trap and restore, tab panel wiring and
arrow keys, 38 colour literals, naaf residue in `threadScope.ts` and
`.env.example`, mock-mode SSE reconnecting forever, and a dropzone whose "browse"
did nothing.

**Lesson worth keeping:** the suite was green at every point above. Tests that
render a component directly cannot tell you whether anything reaches it.

---

# Second review pass — 2026-08-09

15 of the 17 fixes held under adversarial re-testing, including every one I
asked to be attacked. Ten residual findings; all verified, all now fixed.

**The two that mattered were the same error twice: a fix whose test was narrower
than the behaviour its name promised.**

- `useTabs` arrow keys changed *selection* but never moved *focus*, so a user was
  left on a `tabindex="-1"` element that was no longer selected — nothing
  announced, and the next Tab exited the group with no way back. Its test
  asserted `aria-selected` only, never `document.activeElement`.
- The Threads screen destructured `tablistProps` and `tabProps` and dropped
  `panelProps`, so both tabs carried `aria-controls` pointing at ids that did not
  exist. That is worse than the pre-fix state, which at least made no promise.

**The one that would have bitten a new contributor:** `.env.example` and
`AGENTS.md` both claimed the UI runs fully mocked by default. Vite never loads
`.env.example`, and `.env` is gitignored — so on a fresh clone `VITE_USE_MOCKS`
was undefined and the app ran *unmocked*, contradicting spec §6. Mock-first is
now the true default: only an explicit `VITE_USE_MOCKS=false` turns it off.

**Both new guards were weak in the same way as the bug they replaced.** The
colour-literal test matched only 6-digit hex in `.tsx` files — `#fff`,
`#0e0f11ff` and anything in a `.ts` module passed. Hardening it immediately
found a real `#fff` in `Toggle.tsx`. And "draws something visible" passed for
`outline: 0px` and `outline: 2px solid transparent`, both of which remove the
ring the test exists to protect.

Also fixed: the chat panel now has the composer its capability list already
claimed; the artifact chip's label matches the handoff; the dead filter chip is
gone rather than rendering a control that does nothing; orphan registry entries
and their unused clients removed.

**Reviewer's own near-miss, worth recording:** its first harness used
`createMemoryRouter` and reported three phantom CRITICALs — a broken view
switcher, a dead index redirect, wrong nav URLs. A sanity check ("does *any*
navigation work here?") showed the harness itself was broken. The same failure
mode we keep finding in the code exists in the tools used to review it.

## Still open

Pixel fidelity against `Roster Hi-Fi.dc.html` — unchanged, and now larger:
`ListView` (Screen A) is new and was built from the written spec alone. Nobody
has seen it rendered against the canvas.
