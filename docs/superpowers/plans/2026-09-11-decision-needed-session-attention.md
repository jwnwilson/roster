# Decision-needed session attention — implementation plan

**Goal:** Make every agent session blocked on a user decision discoverable and
directly reachable, matching the design handoff's `approval` / “needs you”
state without creating a competing workflow state.

**Decision:** [ADR 0004](../../adr/0004-decision-needed-is-session-approval.md)
keeps `Session.status === 'approval'` as the canonical state. A pending
`Approval`—whether it contains a command or structured questions—is the
decision payload. “Needs you” remains the user-facing label from the handoff;
“decision-needed” is only the feature name used in this plan.

## What exists, and the gap to close

Roster already has most of the handoff:

- `shared/status.ts` labels `approval` as “needs you” and rolls it up from
  sessions to agents.
- `src/screens/AgentsGrid.tsx` gives an approval agent card an amber border
  and `rosterPulse`, while every session chip has a status dot and opens its
  session directly.
- `src/screens/AgentDetail.tsx` renders the command approval banner and
  renders structured questions in the transcript.

The remaining gap is session-level attention. An approval session has only a
5px dot in the grid and a dot in the tab strip, so a user can spot that an
agent needs them without reliably identifying *which* session does. Questions
are also decision-needed even though their controls are not in the command
banner. The implementation must make both kinds of pending approval visible
and reachable, while preserving the existing interactions.

The design handoff is the visual source:

- `docs/design_handoff/README.md`, Agents Grid and Agent Detail sections:
  amber `approval` state, “needs you” wording, pulsing parent card, session
  chips/tabs with origin glyphs and status dots.
- `docs/design_handoff/Roster.dc.html`: the `approval` status vocabulary,
  `rosterPulse`, session-chip navigation, and conditional active-session
  approval banner.

## Scope and non-goals

In scope:

- visible, keyboard-accessible attention treatment for approval sessions on
  agent-grid chips and agent-detail tabs;
- an explicit, testable predicate shared by those views;
- preserving existing amber card pulse, direct session navigation, approval
  banner, and question answering.

Out of scope:

- a `decision_needed` database column, status enum member, or second approval
  protocol;
- task/project decision records, pinning, or ADR generation;
- changing the runner permission APIs or approval resolution semantics.

## Work breakdown and ownership

### 1. Establish the session-attention contract — Tech Lead (first)

**Why first:** Every visual surface needs the same definition of “needs you.”
Starting with the selector prevents a command-only highlight in one surface
and a question-only highlight in another.

**Files:**

- Modify: `shared/status.ts`
- Test: `tests/main/status.test.ts`

**Steps:**

- [ ] Add a named, pure predicate for a session requiring user attention,
  based on `status === 'approval'`. Do not inspect UI-local approval arrays;
  inactive sessions may not have their approval payload loaded in the renderer.
- [ ] Keep `rollUpAgentStatus` as the agent-level reduction and add tests that
  document approval's priority over running, done, and idle work.
- [ ] Add an exported attention style helper only if both renderer surfaces
  need the same class/token decision; otherwise keep the predicate alone.

**Expected return:** One focused PR with red-to-green unit tests and no schema,
IPC, or runner changes. The exported contract must make it impossible for a
question-bearing approval to be treated differently from a command approval.

### 2. Highlight grid session chips — Renderer agent

**Depends on:** Task 1

**Files:**

- Modify: `src/screens/AgentsGrid.tsx`
- Modify: `src/styles/tokens.css` only if a reusable attention token is needed
- Test: `tests/renderer/AgentsGrid.test.tsx`

**Steps:**

- [ ] Apply the shared predicate to `SessionChip`.
- [ ] Preserve the handoff's origin glyph, title truncation, amber status dot,
  direct click/Enter/Space navigation, and selected-session styling.
- [ ] Add a restrained amber border/background treatment to an unselected
  approval chip. The selected style must remain legible; do not add a second
  pulse per chip because the parent card already supplies the handoff's 2s
  attention animation.
- [ ] Add renderer tests for: one approval session among ordinary sessions;
  opening the highlighted chip; selected plus approval; no treatment for
  running/done/idle sessions; keyboard activation.

**Expected return:** A self-contained renderer PR, screenshots or test output,
and an accessibility note covering focus and contrast.

### 3. Highlight agent-detail session tabs — Renderer agent

**Depends on:** Task 1; can run in parallel with Task 2

**Files:**

- Modify: `src/screens/AgentDetail.tsx`
- Modify: `src/styles/tokens.css` only if Task 2 has not already introduced a
  suitable shared token
- Test: `tests/renderer/AgentDetail.test.tsx`

**Steps:**

- [ ] Apply the predicate to `SessionTab`, retaining its status dot, origin
  label, active tab state, delete-button behaviour, and horizontal scrolling.
- [ ] Give an inactive approval tab the same bounded amber attention cue as a
  grid chip; active approval uses a compatible cue without competing with the
  approval banner or question controls below.
- [ ] Ensure the tab has an accessible name that communicates its status—via
  visible “needs you” text or an equivalent `aria-label`/description—not only
  colour and a dot.
- [ ] Test command approvals and question-bearing approvals through their
  shared session status; test selecting the tab reveals the existing relevant
  command banner or question control.

**Expected return:** A self-contained renderer PR that does not alter approval
resolution. Report the tests proving navigation works for both decision forms.

### 4. Integrate and verify lifecycle transitions — Tech Lead + reviewer

**Depends on:** Tasks 1–3

**Files:**

- Modify tests only as needed: `tests/renderer/AgentsWorkflow.test.tsx`,
  `tests/main/sessions.test.ts`, and the tests above

**Steps:**

- [ ] Integrate the two renderer changes without duplicating CSS tokens or
  diverging predicates.
- [ ] Verify an approval event highlights the session and rolls its agent to
  “needs you”; resolving it removes the session cue and restores the next
  highest session status.
- [ ] Verify the grid's agent card retains exactly one pulse and that filters,
  archived-project filtering, handoff links, and session deletion are
  unaffected.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run check`.

**Expected return from reviewer:** Review focused on status-transition races,
keyboard navigation, colour-only signalling, and visual competition between
the card pulse, session cue, banner, and question controls. Include the exact
commands run and their results.

## Delivery sequence

1. Land Task 1 first; it is the semantic seam for all later work.
2. Hand Tasks 2 and 3 to separate renderer agents in parallel once that seam
   is accepted.
3. The tech lead integrates only clean, independently tested PRs, then gives
   Task 4 to a reviewer for interaction-boundary verification.

Each implementation task must use its own worktree, branch, and PR. No work
lands directly on `main`.

## Acceptance criteria

- A session waiting for either a command decision or a structured answer is
  visibly labelled/announced as needing the user in the grid and detail tabs.
- The user can activate that session from either surface using pointer or
  keyboard and reach the existing decision controls.
- An agent with at least one such session retains the amber, pulsing “needs
  you” card treatment from the handoff.
- Resolving the last pending approval removes the attention cue from that
  session and updates the agent roll-up correctly.
- No database migration, new status value, or runner protocol change is
  introduced.
