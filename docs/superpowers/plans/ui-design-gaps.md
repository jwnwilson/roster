# UI vs the hi-fi canvas — 2026-08-09

The gap every previous pass recorded as "needs a human eye". It is now largely
closed by machine: the canvas is HTML, so its values are extractable and can be
diffed against the code rather than eyeballed.

**Method.** Parsed `docs/design/Roster Hi-Fi.dc.html` for every `font-size`,
`border-radius`, colour and component dimension, and diffed against
`projects/ui/src/lib/theme/tokens.css` and the components.

**What could not be done.** Rendering the app for a true visual comparison.
Playwright MCP needs a browser-extension bridge that is not installed, and
headless Chrome — both `--headless` and `--headless=new`, with a virtual time
budget — returned a page painted with the correct background and no DOM. So
layout, alignment and overflow are still unverified by eye. Everything below is
a value-level comparison, which is narrower but exact.

## G1 — Whole regions of four screens were never built (HIGH) — **FIXED**

Specified in the handoff, absent from the code. These are not polish items; they
are missing thirds of screens.

| Region | Handoff | Status |
|---|---|---|
| **Live Agents ribbon**, 76px | §Screen B | **absent** — no component, no reference |
| **Work item right rail**, 252px — PROPERTIES · TOKEN USAGE · RECENT ACTIVITY · ATTACHMENTS | §Screen D | **absent** |
| **Agent detail right rail**, 372px — CONFIG.YAML card, SKILLS, MCP SERVERS | §C2 | partial: fields exist, not as the rail |
| **MCP detail right rail**, 392px — TOOLS, AGENT ACCESS | §K2 | partial: sections exist, not as the rail |

All four are now built, each with a test naming the region. The mutation check
that mattered: removing the ribbon from `BoardScreen` did **not** fail its own
tests, because those render `<LiveAgentsRibbon />` directly — the same blind spot
that let these regions go missing. A separate test now asserts it is mounted on
the board, and fails when it is not.

The board and agent screens read as complete because their *main* column is
complete. The ribbon and rails were never in any task's failing test, so nothing
ever failed for their absence.

## G2 — The README's token block is not the canvas's palette (HIGH) — **FIXED**

The tokens are an exact match for `docs/design/README.md` §Design Tokens — that
much every earlier pass confirmed and it is still true. But the README documents
**28 colours and a 9–17px type scale**, while the canvas actually uses:

- **75 distinct colours**, of which **44 have no token**
- **9 font sizes with no token**: 7, 7.5, 8, 8.5, 14, 15.5, 18, 20, 30px
- **4 radii with no token**: 1, 1.5, 2, 10px

So "the tokens are exact" was true against the README and false against the
canvas — and the plan names the canvas as the visual authority. Anything built
strictly from tokens cannot currently reach the canvas's values.

All 75 canvas colours, 21 font sizes and 11 radii now have tokens, named for the
role each plays rather than for its hue. A test diffs the token file against the
canvas directly, so the gap cannot silently reopen — mutation-checked by changing
one colour and by deleting one size, both caught.

`#2563eb` is deliberately **not** tokenised: it appears once in the canvas and
nowhere in the README, and looks like a stray browser default rather than a
roster colour. The test excludes it by name, so the exclusion is visible rather
than an accident. Worth confirming with whoever produced the canvas.

**The README is still wrong**, and that is now the open item rather than the
tokens: it documents 28 colours and a 9–17px scale for a canvas that uses 75 and
7–30px. Fixing the source document is a separate change from fixing the code.

## G3 — Dimensions that are correct

Verified equal to the canvas: sidebar 214px, topbar 44px, chat panel 292/34px,
thread list pane 356px, list row 34px, list ID column 62px, group header 30px,
settings subnav 176px.

## Recommended order

1. G1 — build the four missing regions. Each needs its own failing test naming
   the region, or the same gap recurs.
2. G2 — extend the type, radius and colour scales to the canvas's actual values,
   and correct the README so it stops under-describing its own canvas.
3. Then a rendered comparison, which still needs either the Playwright bridge
   installed or a human with the canvas open.
