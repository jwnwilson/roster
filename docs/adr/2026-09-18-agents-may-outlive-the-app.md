# ADR: A cloud agent may outlive the app, and its parked decisions are persisted

## Status

Accepted — 2026-09-18

Amends ADR 0005 (`0005-session-liveness-nudges.md`), which states that the
runner cannot survive the process that owned it and that Roster needs no
separate scheduler process. Both remain true for local agents, which are the
default and are unchanged. Neither holds for an agent in cloud mode.

Plan: `docs/superpowers/specs/2026-09-18-cloud-agents.md`.

## Context

Roster's agents run inside the Electron main process. A turn dies with the
app, an approval is an unresolved promise in main-process memory, and a CLI
conversation is a file on one machine. Each of those was a deliberate choice
and each is recorded: `recoverInterruptedRuns()` resets every `running` session
to `done` at startup *"because the runner cannot survive the process that owned
it"*; the liveness monitor *"is not a background daemon"*; the Notion OAuth
loopback exists so that *"the callback always reaches the process that started
it."*

The requirement that changes this is narrow: an agent should be able to keep
working while the desktop app is closed. It is not a requirement that Roster
stop being local-first, and the two should not be confused. An earlier framing
of this work — a hosted backend authoritative for everything, with the desktop
as a client — would have meant Roster showing nothing without a network, for
work that had never touched the cloud. It is also not buildable as stated:
`SessionManager` takes concrete store classes over one `better-sqlite3` handle,
and the codebase has already rejected a second writer on that file.

Separately, and independent of any cloud work, the in-memory approval has
three bugs on the desktop today. Quitting Roster while an approval is pending
loses it with no record. `PlanFlow.approve` enqueues the build turn before
setting the plan to `building`, so a crash in that window strands the plan as
`building` with no turn behind it and no way to recover it from the UI. And
`recoverInterruptedRuns` presents a crashed turn as a completed one, with no
transcript row saying otherwise.

## Decision

**An agent has a mode: local or cloud.** Local is the default, is the absence
of the field, and does not change. A local agent runs exactly as it does
today, against local SQLite, with no network involved. If this work causes any
observable difference to a local agent, that is a defect.

**A cloud agent's turns run in a container**, and a backend is authoritative
for that agent's sessions. Its turns continue while the desktop app is closed.
Because resume is keyed to both the CLI's own transcript state and an
identical absolute working directory, a session inherits its mode at creation
and cannot move between modes.

**A parked decision is persisted, not held in memory.** The `approvals` table
has existed since migration 1 and has never been read or written; it becomes
the durable record, gaining columns for questions and a plan id.
`pendingApprovals` reads the table rather than in-memory state. This applies to
local mode too, because it is a bug fix there.

**Parking uses two mechanisms, chosen by what the decision means.**
`ExitPlanMode` is denied with a reason — the existing `PlanFlow` shape, where
"stop planning, and here is why" is genuinely the semantics. Questions and
`request_user_decision` are *suspended*: persisted, the turn ended, and the
decision re-posed on resume. They cannot be denied, because a denial tells the
model the user refused — `request_user_decision` returns literally *"The user
declined to make that decision."* — and because answers are merged into the
blocked tool's own input, which a denial has no channel to carry.

**Cloud mode has no per-tool approval gate.** The container's isolation is the
safety boundary, and a cloud session parks only on the three decisions above.
`canUseTool` stays installed and returns `allow` by default, because the plan
body arrives through it and removing the callback would silently remove plan
capture. This is a change for Claude alone; `CodexRunner.respondToApproval` is
already a documented no-op.

**Roster does not replay its own transcript in place of CLI resume.** That
would reimplement context management, which the founding design forbids,
destroy prompt caching, and drop everything not in Roster's transcript.

## Consequences

* An agent can be given work and left to do it, and the answer to a question
  it raises can be given hours later from a freshly opened app.
* Local agents are unaffected, and Roster still runs with no network.
* The desktop gains three bug fixes as a side effect: a pending approval
  survives a restart, an approved plan cannot be stranded in `building`, and an
  interrupted turn says so in its transcript instead of appearing complete.
* "Where does this session run" becomes a concept the UI must show, and a
  session cannot be moved between modes after it starts.
* Cloud mode is Claude-only until a headless Codex login exists. Codex's
  ChatGPT auth is interactive and machine-bound, with no `setup-token`
  equivalent.
* A long-lived CLI token becomes a real credential held outside the user's
  machine, so rotation, revocation and per-session scoping have to be designed
  rather than assumed.
* Two engines over one backend both run the liveness monitor. The durable
  cooldown makes this mostly safe, but it is a read-then-write race with no
  leader election, and it is left open.
* The first four phases of the plan contain no infrastructure and are worth
  doing on their own merits, which is the intended hedge: if cloud mode is
  never built, nothing in phases 1 to 4 was wasted.
